import { urlFor } from "../storage/storage.service.js";
import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { computeState } from "./event.state.js";

// Image de couverture : URL calculées (jamais les URL brutes du fournisseur).
export function coverDto(file) {
  if (!file || file.status !== "READY") return null;
  return {
    id: file.id,
    url: urlFor(file),
    thumbnailUrl: urlFor(file, { thumbnail: true }),
    width: file.width,
    height: file.height,
  };
}

const translationDto = (t) => ({
  slug: t.slug,
  title: t.title,
  description: t.description,
  location: t.location,
});

// Vue complète pour l'administration : toutes les langues et tous les champs de gestion.
export function toAdminDto(event, now = new Date()) {
  return {
    id: event.id,
    status: event.status,
    state: computeState(event, now),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    publishAt: event.publishAt,
    publishedAt: event.publishedAt,
    cancelledAt: event.cancelledAt,
    isFeatured: event.isFeatured,
    registrationRequired: event.registrationRequired,
    registrationUrl: event.registrationUrl,
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
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isFeatured: event.isFeatured,
    registrationRequired: event.registrationRequired,
    registrationUrl: event.registrationUrl,
    coverImage: coverDto(event.coverImage),
    alternates: Object.fromEntries(event.translations.map((t) => [t.language, t.slug])),
  };
}
