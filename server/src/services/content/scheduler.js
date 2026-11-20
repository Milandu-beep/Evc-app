import { prismaRaw } from "../../config/prisma.js";
import logger from "../../utils/logger.js";
import { domainEvents } from "../../utils/domainEvents.js";
import * as auditService from "../audit.service.js";

// Publication programmée des contenus (événements, actualités) : bascule en PUBLISHED ceux dont
// l'heure est venue. Une seule instruction SQL atomique avec RETURNING : si plusieurs instances du
// serveur tournent, chaque contenu n'est basculé (et signalé) qu'une seule fois.
// La visibilité publique ne dépend PAS de cette tâche (voir *.state.js : isScheduledDue) : un retard
// ou un arrêt de la tâche ne retarde jamais l'affichage d'un contenu programmé.
// Les noms de table viennent de cette liste fixe, jamais d'une entrée utilisateur.
const SOURCES = {
  events: { table: "events", entity: "events", event: "event.published", idKey: "eventId" },
  news: { table: "news", entity: "news", event: "news.published", idKey: "newsId" },
};

async function publishDue(source) {
  const rows = await prismaRaw.$queryRawUnsafe(`
    UPDATE "${source.table}"
       SET "status" = 'PUBLISHED',
           "publishedAt" = COALESCE("publishedAt", now() AT TIME ZONE 'UTC'),
           "updatedAt" = now() AT TIME ZONE 'UTC'
     WHERE "status" = 'SCHEDULED'
       AND "publishAt" <= (now() AT TIME ZONE 'UTC')
       AND "deletedAt" IS NULL
    RETURNING "id", "notifyOnPublish"`);

  for (const row of rows) {
    await auditService.record({
      action: "STATUS_CHANGE",
      entity: source.entity,
      entityId: row.id,
      changes: { action: "publish", from: "SCHEDULED", to: "PUBLISHED", reason: "scheduled" },
    });
    domainEvents.emit(source.event, { [source.idKey]: row.id, notifyOnPublish: row.notifyOnPublish, reason: "scheduled" });
  }
  return rows.length;
}

export const publishDueEvents = () => publishDue(SOURCES.events);
export const publishDueNews = () => publishDue(SOURCES.news);

let timer = null;
let running = false;

export function startScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    if (running) return; // pas de chevauchement
    running = true;
    try {
      for (const [name, source] of Object.entries(SOURCES)) {
        const n = await publishDue(source);
        if (n) logger.info(`Publication programmée (${name}) : ${n} publié(s)`);
      }
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

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
