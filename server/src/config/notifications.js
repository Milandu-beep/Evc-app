// Constantes du module de notifications.
import env from "./env.js";

export const NOTIFICATION = Object.freeze({
  AUDIENCES: ["ALL", "ADMINS", "MEMBERS", "VISITORS"],
  TITLE_MAX: 80,
  MESSAGE_MAX: 240,
  URL_MAX: 300,
  MAX_ATTEMPTS: 3, // tentatives d'envoi avant l'échec définitif
  RETRY_DELAYS_SECONDS: [60, 300, 900], // attente avant la 2e, la 3e tentative
  STUCK_MINUTES: 10, // un envoi « en cours » plus ancien est repris (arrêt du serveur en plein envoi)
  CLAIM_BATCH: 20,
  MAX_AGE_MS: env.notifications.maxAgeHours * 3600 * 1000, // au-delà, une notification en retard n'est plus envoyée
  DAILY_MESSAGE_TIME: env.notifications.dailyMessageTime,
});
