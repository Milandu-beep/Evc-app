import { EventEmitter } from "node:events";
import logger from "./logger.js";

// Bus d'événements métier interne. Les modules qui réagissent (notifications OneSignal au
// Sprint dédié, par exemple) s'y abonnent sans que le module émetteur les connaisse.
// Un abonné qui plante ne doit jamais faire échouer l'opération qui a émis l'événement.
//
// Événements émis :
//   "event.published"  { eventId, notifyOnPublish, reason: "manual" | "scheduled", adminId? }
//   "event.cancelled"  { eventId, adminId }
const bus = new EventEmitter();

export const domainEvents = {
  on: (name, handler) =>
    bus.on(name, async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        logger.error(`Abonné « ${name} » en échec`, err.message);
      }
    }),
  emit: (name, payload) => bus.emit(name, payload),
};
