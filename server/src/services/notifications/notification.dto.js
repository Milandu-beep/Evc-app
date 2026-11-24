export const NOTIFICATION_INCLUDE = { translations: true };

export const toLogDto = (l) => ({
  id: l.id,
  event: l.event,
  status: l.status,
  message: l.message,
  attempt: l.attempt,
  data: l.data,
  adminId: l.adminId, // vide = action automatique
  createdAt: l.createdAt,
});

// Vue d'administration (jamais de clé ni de secret : seules des données de la notification).
export function toAdminNotificationDto(n) {
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    audience: n.audience,
    scheduledAt: n.scheduledAt,
    sentAt: n.sentAt,
    provider: n.provider,
    providerMessageId: n.providerMessageId,
    recipients: n.recipients,
    attempts: n.attempts,
    lastAttemptAt: n.lastAttemptAt,
    errorMessage: n.errorMessage,
    automatic: Boolean(n.dedupeKey), // créée par un événement de domaine
    dedupeKey: n.dedupeKey,
    links: { eventId: n.eventId, newsId: n.newsId, dailyMessageId: n.dailyMessageId, sermonId: n.sermonId },
    translations: Object.fromEntries(n.translations.map((t) => [t.language, { title: t.title, message: t.message, url: t.url }])),
    createdById: n.createdById,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    deletedAt: n.deletedAt,
  };
}
