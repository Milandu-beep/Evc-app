import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { coverDto, excerptOf } from "../content/dto.js";
import { computeState, dateString, phaseOf } from "./dailyMessage.state.js";

const translationDto = (t) => ({
  title: t.title,
  content: t.content,
  verseReference: t.verseReference,
  verseText: t.verseText,
  theme: t.theme,
  estimatedReadingTime: t.estimatedReadingTime,
  notificationTitle: t.notificationTitle,
  notificationBody: t.notificationBody,
});

// Vue complète pour l'administration : toutes les langues et tous les champs de gestion.
export function toAdminDto(m, now = new Date()) {
  return {
    id: m.id,
    date: dateString(m.date),
    status: m.status,
    state: computeState(m, now),
    phase: phaseOf(m.date, now),
    publishAt: m.publishAt,
    publishedAt: m.publishedAt,
    sendNotification: m.sendNotification,
    image: coverDto(m.image),
    translations: Object.fromEntries(m.translations.map((t) => [t.language, translationDto(t)])),
    createdById: m.createdById,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    deletedAt: m.deletedAt,
  };
}

function localized(m, language) {
  const byLang = Object.fromEntries(m.translations.map((t) => [t.language, t]));
  return byLang[language] ?? byLang[DEFAULT_LANGUAGE] ?? m.translations[0];
}

const base = (m, t) => ({
  id: m.id,
  date: dateString(m.date),
  language: t.language,
  title: t.title,
  verseReference: t.verseReference,
  theme: t.theme,
  estimatedReadingTime: t.estimatedReadingTime,
  image: coverDto(m.image),
  availableLanguages: m.translations.map((x) => x.language),
});

// Liste publique (archive) : extrait seulement.
export function toPublicListDto(m, language) {
  const t = localized(m, language);
  return { ...base(m, t), excerpt: excerptOf(null, t.content) };
}

// Détail public : texte complet et verset. Aucun champ interne (statut, notification, auteur…).
// isFallback : vrai quand le message du jour demandé n'existe pas et qu'on renvoie le dernier publié ;
// requestedDate : la date demandée (aujourd'hui), à comparer à `date`.
export function toPublicDetailDto(m, language, { isFallback = false, requestedDate = null } = {}) {
  const t = localized(m, language);
  return {
    ...base(m, t),
    content: t.content,
    verseText: t.verseText,
    isFallback,
    requestedDate: requestedDate ?? dateString(m.date),
  };
}
