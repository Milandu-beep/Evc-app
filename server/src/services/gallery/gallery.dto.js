import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { isEventPublic } from "../events/event.state.js";
import { coverDto } from "../content/dto.js";
import { urlFor } from "../storage/storage.service.js";
import { dateString } from "../dailyMessages/dailyMessage.state.js";

// Relations chargées avec un album : couverture, événement lié, premier média (couverture de repli) et nombre de médias actifs.
export const ALBUM_INCLUDE = {
  translations: true,
  coverImage: true,
  linkedEvent: { include: { translations: true } },
  items: {
    where: { deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 1,
    include: { storageFile: true },
  },
  _count: { select: { items: { where: { deletedAt: null } } } },
};

export const ITEM_INCLUDE = { translations: true, storageFile: true };

const pickLang = (translations, language) =>
  translations.find((t) => t.language === language) ?? translations.find((t) => t.language === DEFAULT_LANGUAGE) ?? translations[0];

// Fichier d'un média : URL calculées (jamais les URL brutes du fournisseur).
function fileDto(file) {
  if (!file || file.status !== "READY") return null;
  const hasThumb = file.resourceType === "IMAGE" || (file.resourceType === "VIDEO" && file.mimeType?.startsWith("video/"));
  return {
    url: urlFor(file),
    thumbnailUrl: hasThumb ? urlFor(file, { thumbnail: true }) : null,
    width: file.width,
    height: file.height,
    duration: file.duration, // secondes (vidéos)
  };
}

// Couverture d'un album : l'image choisie, sinon le premier média.
function effectiveCover(album) {
  if (album.coverImage) return coverDto(album.coverImage);
  const first = album.items?.[0]?.storageFile;
  return first ? coverDto(first) : null;
}

const albumTranslationDto = (t) => ({ slug: t.slug, title: t.title, description: t.description });

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
export function toAdminAlbumDto(album) {
  const fr = pickLang(album.linkedEvent?.translations ?? [], DEFAULT_LANGUAGE);
  return {
    id: album.id,
    status: album.status,
    date: dateString(album.date),
    isFeatured: album.isFeatured,
    sortOrder: album.sortOrder,
    coverImage: coverDto(album.coverImage), // couverture choisie (null = automatique)
    cover: effectiveCover(album), // couverture affichée
    linkedEventId: album.linkedEventId,
    linkedEvent: album.linkedEvent ? { id: album.linkedEvent.id, status: album.linkedEvent.status, title: fr?.title ?? null } : null,
    itemCount: album._count?.items ?? 0,
    publishedAt: album.publishedAt,
    translations: Object.fromEntries(album.translations.map((t) => [t.language, albumTranslationDto(t)])),
    createdById: album.createdById,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
    deletedAt: album.deletedAt,
  };
}

export function toAdminItemDto(item) {
  return {
    id: item.id,
    albumId: item.albumId,
    type: item.type,
    position: item.position,
    tags: item.tags,
    file: item.storageFile
      ? { id: item.storageFile.id, originalFilename: item.storageFile.originalFilename, mimeType: item.storageFile.mimeType, bytes: item.storageFile.bytes, ...fileDto(item.storageFile) }
      : null,
    translations: Object.fromEntries(item.translations.map((t) => [t.language, { title: t.title, description: t.description, altText: t.altText }])),
    createdById: item.createdById,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
export function toPublicAlbumDto(album, language, now = new Date()) {
  const t = pickLang(album.translations, language);
  const ev = album.linkedEvent && isEventPublic(album.linkedEvent, now) ? album.linkedEvent : null;
  const et = ev ? pickLang(ev.translations, language) : null;
  return {
    id: album.id,
    slug: t.slug,
    language: t.language,
    title: t.title,
    description: t.description,
    date: dateString(album.date),
    isFeatured: album.isFeatured,
    cover: effectiveCover(album),
    itemCount: album._count?.items ?? 0,
    // Événement lié : seulement s'il est lui-même visible du public
    linkedEvent: ev ? { id: ev.id, slug: et.slug, title: et.title, startsAt: ev.startsAt } : null,
    availableLanguages: album.translations.map((x) => x.language),
    alternates: Object.fromEntries(album.translations.map((x) => [x.language, x.slug])),
  };
}

// Média public. Le texte alternatif se replie sur le titre du média, puis sur celui de l'album.
export function toPublicItemDto(item, language, album = null) {
  const t = pickLang(item.translations, language);
  const albumTitle = album ? pickLang(album.translations, language)?.title : null;
  return {
    id: item.id,
    type: item.type,
    position: item.position,
    title: t?.title ?? null,
    description: t?.description ?? null,
    altText: t?.altText ?? t?.title ?? albumTitle ?? null,
    tags: item.tags,
    ...fileDto(item.storageFile),
    ...(album && { album: { id: album.id, slug: pickLang(album.translations, language).slug, title: albumTitle } }),
  };
}
