import { prismaRaw } from "../../config/prisma.js";
import logger from "../../utils/logger.js";
import { domainEvents } from "../../utils/domainEvents.js";
import * as auditService from "../audit.service.js";

// Bascule en PUBLISHED les événements programmés dont l'heure est venue.
// Une seule instruction SQL atomique avec RETURNING : si plusieurs instances du serveur
// tournent, chaque événement n'est basculé (et signalé) qu'une seule fois.
// La visibilité publique ne dépend PAS de cette tâche (voir event.state.js : isScheduledDue) :
// un retard ou un arrêt de la tâche ne retarde jamais l'affichage d'un événement.
export async function publishDueEvents() {
  const rows = await prismaRaw.$queryRaw`
    UPDATE "events"
       SET "status" = 'PUBLISHED',
           "publishedAt" = COALESCE("publishedAt", now() AT TIME ZONE 'UTC'),
           "updatedAt" = now() AT TIME ZONE 'UTC'
     WHERE "status" = 'SCHEDULED'
       AND "publishAt" <= (now() AT TIME ZONE 'UTC')
       AND "deletedAt" IS NULL
    RETURNING "id", "notifyOnPublish"`;

  for (const row of rows) {
    await auditService.record({
      action: "STATUS_CHANGE",
      entity: "events",
      entityId: row.id,
      changes: { action: "publish", from: "SCHEDULED", to: "PUBLISHED", reason: "scheduled" },
    });
    domainEvents.emit("event.published", { eventId: row.id, notifyOnPublish: row.notifyOnPublish, reason: "scheduled" });
  }
  return rows.length;
}

let timer = null;
let running = false;

export function startEventScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    if (running) return; // pas de chevauchement
    running = true;
    try {
      const n = await publishDueEvents();
      if (n) logger.info(`Publication programmée : ${n} événement(s) publié(s)`);
    } catch (err) {
      logger.error("Publication programmée en échec", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref(); // ne retient pas l'arrêt du processus
  tick();
}

export function stopEventScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
