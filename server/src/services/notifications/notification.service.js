// NotificationService : seul point d'entrée pour créer, planifier, annuler et envoyer des notifications.
// Indépendant du fournisseur (OneSignal, faux fournisseur de test ou aucun) : voir providers/.
import prisma, { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import { NOTIFICATION } from "../../config/notifications.js";
import AppError from "../../utils/AppError.js";
import * as auditService from "../audit.service.js";
import { applyTranslationOps, diffScalars, invalid, pageMeta, planTranslations } from "../content/common.js";
import { NOTIFICATION_INCLUDE, toAdminNotificationDto, toLogDto } from "./notification.dto.js";
import { logEvent } from "./notification.log.js";
import { buildMessage } from "./notification.message.js";
import { getProvider } from "./providers/index.js";

const ENTITY = "notifications";
const TEXT_FIELDS = ["title", "message", "url"];
const LINKS = { eventId: ["EVENT", "event"], newsId: ["NEWS", "news"], dailyMessageId: ["DAILY_MESSAGE", "dailyMessage"], sermonId: ["SERMON", "sermon"] };
const CLOCK_TOLERANCE_MS = 5000;

async function loadActive(id) {
  const n = await prisma.notification.findUnique({ where: { id }, include: NOTIFICATION_INCLUDE });
  if (!n) throw new AppError("Notification introuvable", HTTP_STATUS.NOT_FOUND);
  return n;
}

const assertFutureOrNow = (date, now = new Date()) => {
  if (!date || date.getTime() < now.getTime() - CLOCK_TOLERANCE_MS) throw invalid("scheduledAt", "La date d'envoi ne peut pas être dans le passé");
};

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
export async function list(query) {
  const { page, limit, q, status, type, audience, from, to, deleted, sort, order } = query;
  const and = [];
  if (status) and.push({ status });
  if (type) and.push({ type });
  if (audience) and.push({ audience });
  if (from) and.push({ createdAt: { gte: from } });
  if (to) and.push({ createdAt: { lte: to } });
  if (q) and.push({ translations: { some: { OR: ["title", "message"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } });
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };
  // scheduledAt / sentAt peuvent être vides : les lignes sans date passent en dernier
  const orderBy = sort === "createdAt" ? { createdAt: order } : { [sort]: { sort: order, nulls: "last" } };
  const [total, rows] = await Promise.all([
    prismaRaw.notification.count({ where }),
    prismaRaw.notification.findMany({ where, include: NOTIFICATION_INCLUDE, orderBy: [orderBy, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toAdminNotificationDto), meta: pageMeta(page, limit, total) };
}

// Détail avec l'historique complet (du plus ancien au plus récent)
export async function getById(id) {
  const n = await prismaRaw.notification.findUnique({ where: { id }, include: { ...NOTIFICATION_INCLUDE, logs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!n) throw new AppError("Notification introuvable", HTTP_STATUS.NOT_FOUND);
  return { ...toAdminNotificationDto(n), history: n.logs.map(toLogDto) };
}

export async function history(id, { page = 1, limit = 50 } = {}) {
  const exists = await prismaRaw.notification.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError("Notification introuvable", HTTP_STATUS.NOT_FOUND);
  const [total, rows] = await Promise.all([
    prismaRaw.notificationLog.count({ where: { notificationId: id } }),
    prismaRaw.notificationLog.findMany({ where: { notificationId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toLogDto), meta: pageMeta(page, limit, total) };
}

// État du fournisseur (aucun secret)
export function providerStatus() {
  const p = getProvider();
  return { provider: p.name, enabled: p.enabled };
}

// ---------------------------------------------------------------------------
// Création automatique (événements de domaine) : une seule notification par contenu et par événement (dedupeKey)
// ---------------------------------------------------------------------------
export async function createAutomatic({ type, link = {}, translations, scheduledAt, dedupeKey, audience = "ALL" }) {
  const existing = await prismaRaw.notification.findUnique({ where: { dedupeKey } });
  if (existing) return { created: false, notification: existing };

  let notification;
  try {
    notification = await prismaRaw.$transaction(async (tx) => {
      const n = await tx.notification.create({
        data: {
          type,
          status: "SCHEDULED",
          audience,
          scheduledAt,
          dedupeKey,
          ...link,
          translations: { create: Object.entries(translations).map(([language, t]) => ({ language, title: t.title, message: t.message, url: t.url ?? null })) },
        },
        include: NOTIFICATION_INCLUDE,
      });
      await logEvent(n.id, "CREATED", { status: "DRAFT", message: `Création automatique (${dedupeKey.split(":")[0]})`, client: tx });
      await logEvent(n.id, "SCHEDULED", { status: "SCHEDULED", data: { scheduledAt }, client: tx });
      return n;
    });
  } catch (err) {
    if (err?.code === "P2002") return { created: false, notification: await prismaRaw.notification.findUnique({ where: { dedupeKey } }) }; // course entre deux émissions
    throw err;
  }
  await auditService.record({ action: "CREATE", entity: ENTITY, entityId: notification.id, changes: { type, status: "SCHEDULED", automatic: true, languages: Object.keys(translations) } });
  return { created: true, notification };
}

// ---------------------------------------------------------------------------
// Création manuelle
// ---------------------------------------------------------------------------
async function resolveLink(input) {
  const given = Object.keys(LINKS).filter((k) => input[k]);
  if (given.length > 1) throw invalid(given[1], "Un seul contenu lié à la fois (événement, actualité, message du jour ou prédication)");
  if (!given.length) return { type: "GENERAL", link: {} };
  const [field] = given;
  const [type, model] = LINKS[field];
  const found = await prisma[model].findUnique({ where: { id: input[field] }, select: { id: true } });
  if (!found) throw invalid(field, "Contenu introuvable");
  return { type, link: { [field]: input[field] } };
}

export async function create(input, req) {
  const { translations, ...fields } = input;
  const { type, link } = await resolveLink(fields);
  if (fields.scheduledAt) assertFutureOrNow(fields.scheduledAt);
  if (!translations?.fr?.title || !translations?.fr?.message) throw invalid("translations.fr", "Titre et message en français requis");

  const status = fields.scheduledAt ? "SCHEDULED" : "DRAFT";
  const n = await prismaRaw.$transaction(async (tx) => {
    const created = await tx.notification.create({
      data: {
        type,
        status,
        audience: fields.audience ?? "ALL",
        scheduledAt: fields.scheduledAt ?? null,
        createdById: req.user.id,
        ...link,
        translations: { create: Object.entries(translations).filter(([, t]) => t).map(([language, t]) => ({ language, title: t.title, message: t.message, url: t.url ?? null })) },
      },
      include: NOTIFICATION_INCLUDE,
    });
    await logEvent(created.id, "CREATED", { status: "DRAFT", adminId: req.user.id, client: tx });
    if (status === "SCHEDULED") await logEvent(created.id, "SCHEDULED", { status, adminId: req.user.id, data: { scheduledAt: created.scheduledAt }, client: tx });
    return created;
  });
  await auditService.record({ action: "CREATE", entity: ENTITY, entityId: n.id, changes: { type, status, audience: n.audience, languages: Object.keys(translations) }, req });
  return toAdminNotificationDto(n);
}

// ---------------------------------------------------------------------------
// Modification (brouillon ou planifiée) : audience et textes par langue ; null retire une langue
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (!["DRAFT", "SCHEDULED"].includes(current.status)) {
    throw new AppError(`Modification impossible : la notification est ${current.status}`, HTTP_STATUS.CONFLICT);
  }
  const { translations = {}, ...fields } = input;
  const scalarChanges = diffScalars(current, { ...current, ...fields }, ["audience"]);
  const plan = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title", "message"],
    slugTools: null,
    parentId: id,
  });
  if (!Object.keys(scalarChanges).length && !plan.ops.length) return toAdminNotificationDto(current);

  const updated = await prismaRaw.$transaction(async (tx) => {
    await applyTranslationOps(tx.notificationTranslation, plan.ops, "notificationId", id);
    return tx.notification.update({ where: { id }, data: "audience" in fields ? { audience: fields.audience } : {}, include: NOTIFICATION_INCLUDE });
  });
  await auditService.record({ action: "UPDATE", entity: ENTITY, entityId: id, changes: { fields: scalarChanges, translations: plan.changes }, req });
  return toAdminNotificationDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions : planifier / replanifier, envoyer maintenant, annuler, relancer
// ---------------------------------------------------------------------------
async function transition(id, from, data, event, { message, logData, req, auditChanges }) {
  const { count } = await prismaRaw.notification.updateMany({ where: { id, status: { in: from.statuses }, deletedAt: null }, data });
  if (!count) throw new AppError("La notification a changé de statut entre-temps, rechargez-la", HTTP_STATUS.CONFLICT);
  await logEvent(id, event, { status: data.status, message, data: logData, adminId: req?.user?.id });
  await auditService.record({ action: "STATUS_CHANGE", entity: ENTITY, entityId: id, changes: auditChanges, req });
  return toAdminNotificationDto(await prismaRaw.notification.findUnique({ where: { id }, include: NOTIFICATION_INCLUDE }));
}

const assertHasFrench = (n) => {
  const fr = n.translations.find((t) => t.language === "fr");
  if (!fr?.title || !fr?.message) throw invalid("translations.fr", "Titre et message en français requis");
};

export async function schedule(id, scheduledAt, req) {
  const n = await loadActive(id);
  if (!["DRAFT", "SCHEDULED"].includes(n.status)) throw new AppError(`Planification impossible depuis le statut ${n.status}`, HTTP_STATUS.CONFLICT);
  assertHasFrench(n);
  assertFutureOrNow(scheduledAt);
  const event = n.status === "SCHEDULED" ? "RESCHEDULED" : "SCHEDULED";
  return transition(id, { statuses: [n.status] }, { status: "SCHEDULED", scheduledAt, errorMessage: null }, event, {
    logData: { from: n.scheduledAt, to: scheduledAt },
    req,
    auditChanges: { action: event.toLowerCase(), from: n.status, to: "SCHEDULED", scheduledAt },
  });
}

// Envoyer maintenant = planifier à l'instant présent ; l'expéditeur la prend au prochain passage.
export const sendNow = (id, req) => schedule(id, new Date(), req);

export async function cancel(id, reason, req) {
  const n = await loadActive(id);
  if (!["DRAFT", "SCHEDULED"].includes(n.status)) {
    throw new AppError(n.status === "SENDING" ? "Envoi en cours : impossible d'annuler" : `Annulation impossible depuis le statut ${n.status}`, HTTP_STATUS.CONFLICT);
  }
  return transition(id, { statuses: [n.status] }, { status: "CANCELLED" }, "CANCELLED", {
    message: reason || "Annulée par un administrateur",
    req,
    auditChanges: { action: "cancel", from: n.status, to: "CANCELLED", ...(reason && { reason }) },
  });
}

// Relance manuelle d'une notification en échec ou annulée : replanifiée tout de suite, tentatives remises à zéro.
export async function retry(id, req) {
  const n = await loadActive(id);
  if (!["FAILED", "CANCELLED"].includes(n.status)) throw new AppError(`Relance impossible depuis le statut ${n.status}`, HTTP_STATUS.CONFLICT);
  assertHasFrench(n);
  const now = new Date();
  return transition(id, { statuses: [n.status] }, { status: "SCHEDULED", scheduledAt: now, attempts: 0, errorMessage: null }, "SCHEDULED", {
    message: "Relance manuelle",
    logData: { from: n.status },
    req,
    auditChanges: { action: "retry", from: n.status, to: "SCHEDULED" },
  });
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration (jamais pendant que la notification est planifiée ou en cours d'envoi)
// ---------------------------------------------------------------------------
export async function remove(id, req) {
  const n = await loadActive(id);
  if (["SCHEDULED", "SENDING"].includes(n.status)) throw new AppError(`Suppression impossible : la notification est ${n.status} (annulez-la d'abord)`, HTTP_STATUS.CONFLICT);
  await prisma.notification.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { status: n.status }, req });
}

export async function restore(id, req) {
  const n = await prismaRaw.notification.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!n) throw new AppError("Notification introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const restored = await prismaRaw.notification.update({ where: { id }, data: { deletedAt: null }, include: NOTIFICATION_INCLUDE });
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { status: restored.status }, req });
  return toAdminNotificationDto(restored);
}

// ---------------------------------------------------------------------------
// Notification de test : envoyée tout de suite (sans file d'attente) à l'audience ADMINS, avec historique.
// ---------------------------------------------------------------------------
const TEST_TEXTS = {
  fr: { title: "Notification de test", message: "Si vous lisez ceci, les notifications de l'Église Vie Céleste fonctionnent." },
  en: { title: "Test notification", message: "If you can read this, Église Vie Céleste notifications are working." },
};

export async function sendTest({ language, title, message }, req) {
  const provider = getProvider();
  if (!provider.enabled) {
    throw new AppError("Fournisseur de notifications désactivé : renseignez ONESIGNAL_APP_ID et ONESIGNAL_API_KEY", HTTP_STATUS.SERVICE_UNAVAILABLE ?? 503);
  }
  // Texte personnalisé : uniquement dans la langue choisie ; sinon les deux langues avec le texte par défaut
  const texts = title || message ? { [language ?? "fr"]: { title: title ?? TEST_TEXTS[language ?? "fr"].title, message: message ?? TEST_TEXTS[language ?? "fr"].message } } : TEST_TEXTS;
  if (!texts.fr && language === "en") texts.fr = { title: texts.en.title, message: texts.en.message }; // le français sert de repli

  const now = new Date();
  const n = await prismaRaw.$transaction(async (tx) => {
    const created = await tx.notification.create({
      data: { type: "TEST", status: "SENDING", audience: "ADMINS", attempts: 1, lastAttemptAt: now, scheduledAt: now, createdById: req.user.id, translations: { create: Object.entries(texts).map(([lang, t]) => ({ language: lang, title: t.title, message: t.message })) } },
      include: NOTIFICATION_INCLUDE,
    });
    await logEvent(created.id, "CREATED", { status: "DRAFT", adminId: req.user.id, message: "Notification de test", client: tx });
    await logEvent(created.id, "SENDING", { status: "SENDING", attempt: 1, adminId: req.user.id, client: tx });
    return created;
  });

  try {
    const result = await provider.send(buildMessage(n));
    await prismaRaw.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), provider: provider.name, providerMessageId: result.providerMessageId ?? null, recipients: result.recipients ?? null } });
    await logEvent(n.id, "SENT", { status: "SENT", attempt: 1, adminId: req.user.id, data: { provider: provider.name, providerMessageId: result.providerMessageId ?? null, recipients: result.recipients ?? null } });
  } catch (err) {
    const msg = String(err.message ?? err).slice(0, 500);
    await prismaRaw.notification.update({ where: { id: n.id }, data: { status: "FAILED", errorMessage: msg } });
    await logEvent(n.id, "FAILED", { status: "FAILED", attempt: 1, adminId: req.user.id, message: msg });
    throw new AppError(`Échec de l'envoi de test : ${msg}`, HTTP_STATUS.BAD_GATEWAY ?? 502);
  } finally {
    await auditService.record({ action: "CREATE", entity: ENTITY, entityId: n.id, changes: { type: "TEST", audience: "ADMINS" }, req });
  }
  return getById(n.id);
}

export { NOTIFICATION };
