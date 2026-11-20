// Règles communes de la galerie : tags, type de média, cycle de vie des albums.

export const ITEMS_PAGE_MAX = 200;
export { MAX_TAGS, TAG_MAX_LENGTH, normalizeTag, normalizeTags, parseTagFilter, tagsWhere } from "../content/tags.js";

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

// Cycle de vie des albums : brouillon / publié / archivé (voir content/simpleLifecycle.js).
export { PUBLISH_STATES as ALBUM_STATES, PUBLISH_TRANSITIONS as ALBUM_TRANSITIONS, canPublishTransition as canTransition } from "../content/simpleLifecycle.js";
