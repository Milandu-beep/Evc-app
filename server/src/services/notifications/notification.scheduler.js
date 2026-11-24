import logger from "../../utils/logger.js";
import { dispatchDue } from "./notification.dispatcher.js";

let timer = null;
let running = false;

// Passe toutes les 30 s : envoie les notifications dues (voir notification.dispatcher.js).
export function startNotificationScheduler({ intervalMs = 30_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    if (running) return; // pas de chevauchement
    running = true;
    try {
      const r = await dispatchDue();
      if (r.claimed || r.recovered) logger.info(`Notifications : ${r.claimed} traitée(s) — envoyées ${r.sent}, reprises ${r.retried}, échecs ${r.failed}, annulées ${r.cancelled}`);
    } catch (err) {
      logger.error("Envoi des notifications en échec", err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref(); // ne retient pas l'arrêt du processus
  tick();
}

export function stopNotificationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
