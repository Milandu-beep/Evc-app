// Tags partagés (galerie, prédications) : normalisation, filtres. Un tag est en minuscules, sans accents,
// en chiffres et tirets (« Baptême 2026 » -> « bapteme-2026 »), 40 caractères au plus.
import { slugify } from "../../utils/slug.js";
import { invalid } from "./common.js";

export const MAX_TAGS = 20;
export const TAG_MAX_LENGTH = 40;

export const normalizeTag = (raw) => slugify(String(raw ?? ""), { maxLength: TAG_MAX_LENGTH, fallback: "" });

// Liste de tags saisie par l'administrateur : normalisée, sans doublon, 20 au plus (422 au-delà).
export function normalizeTags(rawTags, field = "tags") {
  if (rawTags == null) return [];
  const tags = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw invalid(field, `${MAX_TAGS} tags au maximum`);
  return tags;
}

// Liste de tags d'une requête (« a,b,c ») : normalisée, sans doublon.
export const parseTagFilter = (csv) =>
  [...new Set(String(csv ?? "").split(",").map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS);

// Filtre Prisma sur les tags : « all » (tous, par défaut) ou « any » (au moins un).
export const tagsWhere = (tags, match = "all") => (tags.length ? { tags: match === "any" ? { hasSome: tags } : { hasEvery: tags } } : {});
