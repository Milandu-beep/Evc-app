import { prismaRaw } from "../../config/prisma.js";

/**
 * Écrit une ligne de l'historique d'une notification (journal append-only).
 * event : CREATED, SCHEDULED, RESCHEDULED, SENDING, SENT, RETRY, FAILED, CANCELLED.
 * status : statut de la notification APRÈS l'événement. adminId vide = action automatique.
 * client : le client Prisma ou une transaction (défaut : client brut).
 */
export function logEvent(notificationId, event, { status = null, message = null, attempt = null, data = null, adminId = null, client = prismaRaw } = {}) {
  return client.notificationLog.create({
    data: { notificationId, event, status, message, attempt, data: data ?? undefined, adminId },
  });
}
