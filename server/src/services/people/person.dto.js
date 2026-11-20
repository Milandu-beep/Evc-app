import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { coverDto, excerptOf } from "../content/dto.js";

const pickLang = (translations, language) =>
  translations.find((t) => t.language === language) ?? translations.find((t) => t.language === DEFAULT_LANGUAGE) ?? translations[0];

export const fullName = (p) => `${p.firstName} ${p.lastName}`.trim();

export const PERSON_INCLUDE = { translations: true, photo: true };

// Vue complète pour l'administration (toutes les langues, tous les champs de gestion).
export function toAdminPersonDto(p) {
  return {
    id: p.id,
    status: p.status,
    firstName: p.firstName,
    lastName: p.lastName,
    name: fullName(p),
    slug: p.slug,
    categories: p.categories,
    sortOrder: p.sortOrder,
    photo: coverDto(p.photo),
    publishedAt: p.publishedAt,
    translations: Object.fromEntries(p.translations.map((t) => [t.language, { title: t.title, bio: t.bio }])),
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}

// Vue publique d'une fiche (liste : biographie abrégée ; détail : biographie complète).
export function toPublicPersonDto(p, language, { full = false } = {}) {
  const t = pickLang(p.translations, language);
  return {
    id: p.id,
    slug: p.slug,
    firstName: p.firstName,
    lastName: p.lastName,
    name: fullName(p),
    categories: p.categories,
    photo: coverDto(p.photo),
    language: t?.language ?? language,
    title: t?.title ?? null,
    bio: full ? (t?.bio ?? null) : t?.bio ? excerptOf(null, t.bio, 240) : null,
    availableLanguages: p.translations.map((x) => x.language),
  };
}

// Personne affichée dans une autre ressource (ex. intervenant d'une prédication) : le nom est toujours montré,
// la fiche (slug) et la photo seulement si la fiche est publique.
export function toPersonRefDto(p, language) {
  const isPublic = p.status === "PUBLISHED" && !p.deletedAt;
  const t = pickLang(p.translations ?? [], language);
  return {
    id: p.id,
    name: fullName(p),
    slug: isPublic ? p.slug : null,
    photo: isPublic ? coverDto(p.photo) : null,
    title: isPublic ? (t?.title ?? null) : null,
  };
}
