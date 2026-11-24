// Expéditeur : prend les notifications planifiées arrivées à échéance et les envoie via le fournisseur.
//  - réservation ATOMIQUE (FOR UPDATE SKIP LOCKED) : plusieurs instances du serveur ne s'envoient jamais la même notification ;
//  - reprise automatique (3 tentatives, attente croissante) pour les incidents passagers, échec définitif sinon ;
//  - les notifications trop en retard (fournisseur désactivé pendant des jours, par exemple) ne sont plus envoyées ;
//  - une notification dont le contenu n'est plus publié est annulée avant l'envoi ;
//  - un envoi resté « en cours » (arrêt du serveur) est repris : l'identifiant d'idempotence évite le doublon chez le fournisseur.
import { prismaRaw } from "../../config/prisma.js";
import { NOTIFICATION } from "../../config/notifications.js";
import logger from "../../utils/logger.js";
import { isScheduledDue } from "../content/lifecycle.js";
import { isEventPublic } from "../events/event.state.js";
import { getProvider } from "./providers/index.js";
import { logEvent } from "./notification.log.js";
import { buildMessage } from "./notification.message.js";

const isPublished = (item, now) => !!item && !item.deletedAt && (item.status === "PUBLISHED" || isScheduledDue(item, now));

// Motif d'annulation si le contenu lié n'est plus publié, sinon null.
async function contentGuard(n, now) {
  switch (n.type) {
    case "EVENT": {
      if (!n.eventId) return "L'événement n'existe plus";
      const ev = await prismaRaw.event.findUnique({ where: { id: n.eventId } });
      return isEventPublic(ev, now) ? null : "L'événement n'est plus publié";
    }
    case "NEWS": {
      const row = n.newsId && (await prismaRaw.news.findUnique({ where: { id: n.newsId } }));
      return isPublished(row, now) ? null : "L'actualité n'est plus publiée";
    }
    case "DAILY_MESSAGE": {
      const row = n.dailyMessageId && (await prismaRaw.dailyMessage.findUnique({ where: { id: n.dailyMessageId } }));
      return isPublished(row, now) ? null : "Le message du jour n'est plus publié";
    }
    case "SERMON": {
      const row = n.sermonId && (await prismaRaw.sermon.findUnique({ where: { id: n.sermonId } }));
      return isPublished(row, now) ? null : "La prédication n'est plus publiée";
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Réservation et reprise
// ---------------------------------------------------------------------------
export async function claimDue(now, limit) {
  const rows = await prismaRaw.$queryRaw`
    UPDATE "notifications"
       SET "status" = 'SENDING', "attempts" = "attempts" + 1, "lastAttemptAt" = ${now}, "updatedAt" = ${now}
     WHERE "id" IN (
       SELECT "id" FROM "notifications"
        WHERE "status" = 'SCHEDULED' AND "deletedAt" IS NULL AND "scheduledAt" <= ${now}
        ORDER BY "scheduledAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  return rows.map((r) => r.id);
}

// Envois restés « en cours » : replanifiés (ou en échec définitif si les tentatives sont épuisées).
export async function recoverStuck(now) {
  const limit = new Date(now.getTime() - NOTIFICATION.STUCK_MINUTES * 60 * 1000);
  const rows = await prismaRaw.$queryRaw`
    UPDATE "notifications"
       SET "status" = (CASE WHEN "attempts" >= ${NOTIFICATION.MAX_ATTEMPTS} THEN 'FAILED' ELSE 'SCHEDULED' END)::"NotificationStatus",
           "scheduledAt" = COALESCE("scheduledAt", ${now}),
           "errorMessage" = 'Envoi interrompu (arrêt du serveur ou délai dépassé)',
           "updatedAt" = ${now}
     WHERE "status" = 'SENDING' AND "deletedAt" IS NULL AND "lastAttemptAt" < ${limit}
    RETURNING "id", "status", "attempts"`;
  for (const r of rows) {
    await logEvent(r.id, r.status === "FAILED" ? "FAILED" : "RETRY", {
      status: r.status,
      attempt: r.attempts,
      message: r.status === "FAILED" ? "Envoi interrompu : tentatives épuisées" : "Reprise après interruption de l'envoi",
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Envoi d'une notification réservée (statut SENDING)
// ---------------------------------------------------------------------------
async function cancel(n, message) {
  const { count } = await prismaRaw.notification.updateMany({ where: { id: n.id, status: "SENDING" }, data: { status: "CANCELLED", errorMessage: message } });
  if (count) await logEvent(n.id, "CANCELLED", { status: "CANCELLED", attempt: n.attempts, message });
  return "cancelled";
}

export async function dispatchOne(id, now = new Date()) {
  const n = await prismaRaw.notification.findUnique({ where: { id }, include: { translations: true } });
  if (!n || n.status !== "SENDING") return "skipped";
  await logEvent(id, "SENDING", { status: "SENDING", attempt: n.attempts, message: `Tentative ${n.attempts}/${NOTIFICATION.MAX_ATTEMPTS}` });

  if (n.type !== "TEST" && n.scheduledAt && now.getTime() - n.scheduledAt.getTime() > NOTIFICATION.MAX_AGE_MS) {
    return cancel(n, `Expirée : planifiée il y a plus de ${Math.round(NOTIFICATION.MAX_AGE_MS / 3600000)} h, elle n'est plus envoyée`);
  }
  const reason = await contentGuard(n, now);
  if (reason) return cancel(n, reason);
  if (!n.translations.length) return cancel(n, "Aucun texte à envoyer");

  const provider = getProvider();
  try {
    const result = await provider.send(buildMessage(n));
    const { count } = await prismaRaw.notification.updateMany({
      where: { id, status: "SENDING" },
      data: { status: "SENT", sentAt: now, provider: provider.name, providerMessageId: result.providerMessageId ?? null, recipients: result.recipients ?? null, errorMessage: null },
    });
    if (count) {
      await logEvent(id, "SENT", {
        status: "SENT",
        attempt: n.attempts,
        message: result.recipients === 0 ? "Envoyée (aucun abonné à joindre)" : null,
        data: { provider: provider.name, providerMessageId: result.providerMessageId ?? null, recipients: result.recipients ?? null, ...(result.deduplicated && { deduplicated: true }) },
      });
    }
    return "sent";
  } catch (err) {
    const retryable = err.retryable ?? true; // une erreur inattendue est retentée (dans la limite des tentatives)
    const message = String(err.message ?? err).slice(0, 500);
    if (retryable && n.attempts < NOTIFICATION.MAX_ATTEMPTS) {
      const delay = NOTIFICATION.RETRY_DELAYS_SECONDS[Math.min(n.attempts - 1, NOTIFICATION.RETRY_DELAYS_SECONDS.length - 1)];
      const nextAttemptAt = new Date(now.getTime() + delay * 1000);
      const { count } = await prismaRaw.notification.updateMany({ where: { id, status: "SENDING" }, data: { status: "SCHEDULED", scheduledAt: nextAttemptAt, errorMessage: message } });
      if (count) await logEvent(id, "RETRY", { status: "SCHEDULED", attempt: n.attempts, message, data: { nextAttemptAt, status: err.status ?? null } });
      return "retried";
    }
    const { count } = await prismaRaw.notification.updateMany({ where: { id, status: "SENDING" }, data: { status: "FAILED", errorMessage: message } });
    if (count) await logEvent(id, "FAILED", { status: "FAILED", attempt: n.attempts, message, data: { retryable, status: err.status ?? null } });
    logger.warn(`Notification ${id} en échec : ${message}`);
    return "failed";
  }
}

/**
 * Traite les notifications dues. Sans fournisseur actif (clés absentes), ne fait rien : elles restent planifiées.
 * now : injectable pour les tests (voyage dans le temps).
 */
export async function dispatchDue({ now = new Date(), limit = NOTIFICATION.CLAIM_BATCH } = {}) {
  const provider = getProvider();
  const report = { provider: provider.name, enabled: provider.enabled, recovered: 0, claimed: 0, sent: 0, retried: 0, failed: 0, cancelled: 0 };
  if (!provider.enabled) return report;

  report.recovered = await recoverStuck(now);
  const ids = await claimDue(now, limit);
  report.claimed = ids.length;
  for (const id of ids) {
    try {
      const outcome = await dispatchOne(id, now);
      if (outcome in report) report[outcome] += 1;
    } catch (err) {
      logger.error(`Notification ${id} : erreur inattendue`, err.message);
    }
  }
  return report;
}
