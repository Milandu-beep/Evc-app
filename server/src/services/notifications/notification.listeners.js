// Abonnements aux événements de domaine. C'est ici, et seulement ici, que les modules de contenu rencontrent
// les notifications : ils émettent leur événement, ce module crée la notification correspondante.
import logger from "../../utils/logger.js";
import { domainEvents } from "../../utils/domainEvents.js";
import * as content from "./notification.content.js";
import * as notificationService from "./notification.service.js";

// Traite un événement de domaine : crée (une seule fois) la notification planifiée correspondante.
export async function processDomainEvent(name, payload) {
  const builders = {
    "event.published": content.fromEvent,
    "news.published": content.fromNews,
    "daily-message.published": content.fromDailyMessage,
    "sermon.published": content.fromSermon,
  };
  const spec = await builders[name](payload);
  if (!spec) {
    logger.debug(`${name} : aucune notification à créer`);
    return { created: false };
  }
  const { created, notification } = await notificationService.createAutomatic(spec);
  if (created) logger.info(`${name} : notification ${notification.id} planifiée pour le ${notification.scheduledAt.toISOString()}`);
  return { created, notification };
}

export const DOMAIN_EVENTS = ["event.published", "news.published", "daily-message.published", "sermon.published"];

let registered = false;

// Idempotent. À appeler une fois au démarrage du serveur (pas dans app.js : les suites de tests des modules de contenu n'en dépendent pas).
export function registerNotificationListeners() {
  if (registered) return;
  registered = true;
  for (const name of DOMAIN_EVENTS) domainEvents.on(name, (payload) => processDomainEvent(name, payload)); // les erreurs sont journalisées par domainEvents
}
