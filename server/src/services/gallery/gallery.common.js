// Règles communes de la galerie : tags, type de média, cycle de vie des albums.
import { slugify } from "../../utils/slug.js";
import { invalid } from "../content/common.js";

export const MAX_TAGS = 20;
export const TAG_MAX_LENGTH = 40;
export const ITEMS_PAGE_MAX = 200;

// Tag normalisé : minuscules, sans accents, chiffres et tirets (« Baptême 2026 » -> « bapteme-2026 »).
export const normalizeTag = (raw) => slugify(String(raw ?? ""), { maxLength: TAG_MAX_LENGTH, fallback: "" });

// Liste de tags saisie par l'administrateur : normalisée, sans doublon, 20 au maximum (422 au-delà).
export function normalizeTags(rawTags, field = "tags") {
  if (rawTags == null) return [];
  const tags = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw invalid(field, `${MAX_TAGS} tags au maximum par média`);
  return tags;
}

// Liste de tags d'une requête (« a,b,c ») : normalisée, sans doublon (le filtre n'a pas de limite stricte).
export const parseTagFilter = (csv) =>
  [...new Set(String(csv ?? "").split(",").map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS);

// Filtre Prisma sur les tags : « all » (tous, par défaut) ou « any » (au moins un).
export const tagsWhere = (tags, match = "all") => (tags.length ? { tags: match === "any" ? { hasSome: tags } : { hasEvery: tags } } : {});

// Type de média de galerie déduit du fichier stocké : image -> PHOTO, vidéo hébergée -> VIDEO.
// Les fichiers audio (stockés comme « vidéo » chez Cloudinary) et les PDF ne sont pas des médias de galerie.
export function itemTypeOf(file) {
  if (file.resourceType === "IMAGE") return "PHOTO";
  if (file.resourceType === "VIDEO" && file.mimeType?.startsWith("video/")) return "VIDEO";
  return null;
}

export const ITEM_ORDER = [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }];

// Albums visibles du public : publiés et non supprimés.
export const publicAlbumWhere = { deletedAt: null, status: "PUBLISHED" };

// Cycle de vie des albums : brouillon / publié / archivé (pas de programmation).
export const ALBUM_STATES = ["DRAFT", "PUBLISHED", "ARCHIVED"];
export const ALBUM_TRANSITIONS = Object.freeze({
  publish: { from: ["DRAFT"], to: "PUBLISHED" },
  unpublish: { from: ["PUBLISHED"], to: "DRAFT" },
  archive: { from: ["DRAFT", "PUBLISHED"], to: "ARCHIVED" },
  unarchive: { from: ["ARCHIVED"], to: "DRAFT" },
});
export const canTransition = (action, status) => ALBUM_TRANSITIONS[action]?.from.includes(status) ?? false;
