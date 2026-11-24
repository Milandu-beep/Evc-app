// Construction des notifications AUTOMATIQUES à partir des événements de domaine émis par les modules de contenu
// (event.published, news.published, daily-message.published, sermon.published). Ces modules n'appellent jamais
// un fournisseur : ils émettent seulement leur événement, ce fichier décide quoi envoyer.
// Chaque fonction retourne la description d'une notification (à passer à createAutomatic) ou null s'il n'y a rien à envoyer.
import env from "../../config/env.js";
import { NOTIFICATION } from "../../config/notifications.js";
import { prismaRaw } from "../../config/prisma.js";
import { localDateTimeToUtc } from "../../utils/timezone.js";
import { isScheduledDue } from "../content/lifecycle.js";
import { dateString, todayString } from "../dailyMessages/dailyMessage.state.js";
import { hasEnded, isEventPublic } from "../events/event.state.js";

// Libellés d'en-tête par langue
const LABELS = {
  event: { fr: "Nouvel événement", en: "New event" },
  news: { fr: "Actualité", en: "News" },
  dailyMessage: { fr: "Message du jour", en: "Message of the day" },
  sermon: { fr: "Nouvelle prédication", en: "New sermon" },
};

const truncate = (text, max = NOTIFICATION.MESSAGE_MAX) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};
const join = (...parts) => parts.filter(Boolean).join(" · ");
const isPublished = (item, now) => !!item && !item.deletedAt && (item.status === "PUBLISHED" || isScheduledDue(item, now));

// Une entrée par langue disponible ; le français est toujours présent sur un contenu publié.
function perLanguage(translations, build) {
  const out = {};
  for (const t of translations) out[t.language] = build(t, t.language);
  return out;
}

export async function fromEvent({ eventId, notifyOnPublish }, now = new Date()) {
  if (!notifyOnPublish) return null;
  const ev = await prismaRaw.event.findUnique({ where: { id: eventId }, include: { translations: true } });
  if (!isEventPublic(ev, now) || hasEnded(ev, now)) return null; // inutile d'annoncer un événement déjà terminé
  return {
    type: "EVENT",
    link: { eventId },
    dedupeKey: `event.published:${eventId}`,
    scheduledAt: now,
    translations: perLanguage(ev.translations, (t, lang) => ({ title: LABELS.event[lang], message: truncate(join(t.title, t.location)), url: `/events/${t.slug}` })),
  };
}

export async function fromNews({ newsId, notifyOnPublish }, now = new Date()) {
  if (!notifyOnPublish) return null;
  const row = await prismaRaw.news.findUnique({ where: { id: newsId }, include: { translations: true } });
  if (!isPublished(row, now)) return null;
  return {
    type: "NEWS",
    link: { newsId },
    dedupeKey: `news.published:${newsId}`,
    scheduledAt: now,
    translations: perLanguage(row.translations, (t, lang) => ({ title: LABELS.news[lang], message: truncate(t.title), url: `/news/${t.slug}` })),
  };
}

// Heure d'envoi du message du jour : le jour du message à l'heure configurée (heure de l'église).
// Publié le jour même après cette heure : tout de suite. Message d'un jour passé : jamais (null).
export function dailyMessageSendTime(date, now = new Date()) {
  const target = localDateTimeToUtc(date, NOTIFICATION.DAILY_MESSAGE_TIME, env.timeZone);
  if (target > now) return target;
  return date === todayString(now) ? now : null;
}

export async function fromDailyMessage({ dailyMessageId, sendNotification }, now = new Date()) {
  if (!sendNotification) return null;
  const row = await prismaRaw.dailyMessage.findUnique({ where: { id: dailyMessageId }, include: { translations: true } });
  if (!isPublished(row, now)) return null;
  const date = dateString(row.date);
  const scheduledAt = dailyMessageSendTime(date, now);
  if (!scheduledAt) return null;
  return {
    type: "DAILY_MESSAGE",
    link: { dailyMessageId },
    dedupeKey: `daily-message.published:${dailyMessageId}`,
    scheduledAt,
    translations: perLanguage(row.translations, (t, lang) => ({
      // Textes de notification choisis par l'administrateur, à défaut le titre et le verset
      title: truncate(t.notificationTitle || LABELS.dailyMessage[lang], NOTIFICATION.TITLE_MAX),
      message: truncate(t.notificationBody || join(t.title, t.verseReference)),
      url: `/daily-messages/${date}`,
    })),
  };
}

export async function fromSermon({ sermonId, notifyOnPublish }, now = new Date()) {
  if (!notifyOnPublish) return null;
  const row = await prismaRaw.sermon.findUnique({
    where: { id: sermonId },
    include: { translations: true, speakers: { orderBy: [{ position: "asc" }], include: { person: true } } },
  });
  if (!isPublished(row, now)) return null;
  const preacher = row.speakers.find((s) => s.role === "PREACHER")?.person;
  const name = preacher && `${preacher.firstName} ${preacher.lastName}`.trim();
  return {
    type: "SERMON",
    link: { sermonId },
    dedupeKey: `sermon.published:${sermonId}`,
    scheduledAt: now,
    translations: perLanguage(row.translations, (t, lang) => ({ title: LABELS.sermon[lang], message: truncate(join(t.title, name)), url: `/sermons/${t.slug}` })),
  };
}
