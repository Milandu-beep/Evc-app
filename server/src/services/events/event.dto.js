import { coverDto } from "../content/dto.js";
import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { computeState, endOf } from "./event.state.js";

const translationDto = (t) => ({
  slug: t.slug,
  title: t.title,
  description: t.description,
  location: t.location,
});

// Places : capacity null = illimitée ; spotsLeft null si illimitée.
function seats(event) {
  const spotsLeft = event.capacity == null ? null : Math.max(event.capacity - event.registeredCount, 0);
  return { capacity: event.capacity, spotsLeft, isFull: spotsLeft === 0 };
}

// Vue complète pour l'administration : toutes les langues et tous les champs de gestion.
export function toAdminDto(event, now = new Date()) {
  return {
    id: event.id,
    status: event.status,
    state: computeState(event, now),
    type: event.type,
    color: event.color,
    icon: event.icon,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    publishAt: event.publishAt,
    publishedAt: event.publishedAt,
    cancelledAt: event.cancelledAt,
    isFeatured: event.isFeatured,
    registrationRequired: event.registrationRequired,
    registrationUrl: event.registrationUrl,
    ...seats(event),
    registeredCount: event.registeredCount,
    notifyOnPublish: event.notifyOnPublish,
    coverImage: coverDto(event.coverImage),
    translations: Object.fromEntries(event.translations.map((t) => [t.language, translationDto(t)])),
    createdById: event.createdById,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deletedAt: event.deletedAt,
  };
}

// Vue publique : une seule langue (repli sur le français), aucun champ interne.
export function toPublicDto(event, language, now = new Date()) {
  const byLang = Object.fromEntries(event.translations.map((t) => [t.language, t]));
  const chosen = byLang[language] ?? byLang[DEFAULT_LANGUAGE] ?? event.translations[0];
  return {
    id: event.id,
    slug: chosen.slug,
    language: chosen.language,
    title: chosen.title,
    description: chosen.description,
    location: chosen.location,
    state: computeState(event, now),
    type: event.type,
    color: event.color,
    icon: event.icon,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isFeatured: event.isFeatured,
    registrationRequired: event.registrationRequired,
    registrationUrl: event.registrationUrl,
    ...seats(event),
    coverImage: coverDto(event.coverImage),
    alternates: Object.fromEntries(event.translations.map((t) => [t.language, t.slug])),
  };
}

// Entrée du calendrier : léger (pas de description ni d'image), prêt à afficher dans une grille.
// `end` est la fin effective : endsAt, ou 23 h 59 (heure de l'église) du jour de début sans fin renseignée.
export function toCalendarDto(event, language, now = new Date()) {
  const byLang = Object.fromEntries(event.translations.map((t) => [t.language, t]));
  const chosen = byLang[language] ?? byLang[DEFAULT_LANGUAGE] ?? event.translations[0];
  return {
    id: event.id,
    slug: chosen.slug,
    language: chosen.language,
    title: chosen.title,
    location: chosen.location,
    state: computeState(event, now),
    type: event.type,
    color: event.color,
    icon: event.icon,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    end: endOf(event),
    isFeatured: event.isFeatured,
    registrationRequired: event.registrationRequired,
    isFull: seats(event).isFull,
  };
}
