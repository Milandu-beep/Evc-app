import { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { dateOnlyToUtc } from "../../utils/timezone.js";
import { pageMeta } from "../content/common.js";
import { isEventPublic } from "../events/event.state.js";
import { ITEM_ORDER, normalizeTag, parseTagFilter, publicAlbumWhere, tagsWhere } from "./gallery.common.js";
import { ALBUM_INCLUDE, ITEM_INCLUDE, toPublicAlbumDto, toPublicItemDto } from "./gallery.dto.js";

const ALBUM_ORDER = {
  recent: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }], // les plus récents d'abord
  manual: [{ sortOrder: "asc" }, { date: "desc" }, { id: "asc" }], // ordre d'affichage choisi par l'administrateur
};

// Recherche dans un média : titre, description, texte alternatif (toutes langues) ou tag.
function itemSearch(q) {
  const tag = normalizeTag(q);
  return {
    OR: [
      { translations: { some: { OR: ["title", "description", "altText"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } },
      ...(tag ? [{ tags: { has: tag } }] : []),
    ],
  };
}

const activeItem = { deletedAt: null };

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------
export async function listAlbums({ lang, q, tags, match, eventId, featured, from, to, sort, page, limit }, now = new Date()) {
  const and = [];
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (eventId) and.push({ linkedEventId: eventId });
  if (from) and.push({ date: { gte: dateOnlyToUtc(from) } });
  if (to) and.push({ date: { lte: dateOnlyToUtc(to) } });
  const tagFilter = parseTagFilter(tags);
  if (tagFilter.length) and.push({ items: { some: { ...activeItem, ...tagsWhere(tagFilter, match) } } });
  if (q) {
    and.push({
      OR: [
        { translations: { some: { OR: ["title", "description", "slug"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } },
        { items: { some: { ...activeItem, ...itemSearch(q) } } }, // la recherche couvre aussi les médias de l'album
      ],
    });
  }
  const where = { ...publicAlbumWhere, ...(and.length && { AND: and }) };

  const [total, rows] = await Promise.all([
    prismaRaw.galleryAlbum.count({ where }),
    prismaRaw.galleryAlbum.findMany({ where, include: ALBUM_INCLUDE, orderBy: ALBUM_ORDER[sort], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((a) => toPublicAlbumDto(a, lang, now)), meta: pageMeta(page, limit, total) };
}

// Page d'accueil : albums mis en avant (ordre manuel) et albums récents.
export async function home({ lang, limit }, now = new Date()) {
  const [featured, recent] = await Promise.all([
    prismaRaw.galleryAlbum.findMany({ where: { ...publicAlbumWhere, isFeatured: true }, include: ALBUM_INCLUDE, orderBy: ALBUM_ORDER.manual, take: limit }),
    prismaRaw.galleryAlbum.findMany({ where: publicAlbumWhere, include: ALBUM_INCLUDE, orderBy: ALBUM_ORDER.recent, take: limit }),
  ]);
  return { featured: featured.map((a) => toPublicAlbumDto(a, lang, now)), recent: recent.map((a) => toPublicAlbumDto(a, lang, now)) };
}

// Détail d'un album par slug (dans la langue demandée) avec ses médias paginés, filtrables par tags et type.
export async function getAlbumBySlug(slug, { lang, tags, match, type, page, limit }, now = new Date()) {
  const translation = await prismaRaw.galleryAlbumTranslation.findFirst({
    where: { slug, language: lang, album: publicAlbumWhere },
    include: { album: { include: ALBUM_INCLUDE } },
  });
  if (!translation) throw new AppError("Album introuvable", HTTP_STATUS.NOT_FOUND);
  const album = translation.album;

  const where = { albumId: album.id, ...activeItem, ...(type && { type }), ...tagsWhere(parseTagFilter(tags), match) };
  const [total, rows] = await Promise.all([
    prismaRaw.galleryItem.count({ where }),
    prismaRaw.galleryItem.findMany({ where, include: ITEM_INCLUDE, orderBy: ITEM_ORDER, skip: (page - 1) * limit, take: limit }),
  ]);
  return { album: toPublicAlbumDto(album, lang, now), items: rows.map((i) => toPublicItemDto(i, lang, album)), meta: pageMeta(page, limit, total) };
}

// ---------------------------------------------------------------------------
// Recherche transversale de médias (tous albums publiés confondus)
// ---------------------------------------------------------------------------
export async function listItems({ lang, q, tags, match, type, albumId, eventId, page, limit }) {
  const and = [];
  if (q) and.push(itemSearch(q));
  const where = {
    ...activeItem,
    album: { ...publicAlbumWhere, ...(eventId && { linkedEventId: eventId }) },
    ...(albumId && { albumId }),
    ...(type && { type }),
    ...tagsWhere(parseTagFilter(tags), match),
    ...(and.length && { AND: and }),
  };
  const [total, rows] = await Promise.all([
    prismaRaw.galleryItem.count({ where }),
    prismaRaw.galleryItem.findMany({
      where,
      include: { ...ITEM_INCLUDE, album: { include: { translations: true } } },
      orderBy: [{ album: { date: "desc" } }, { albumId: "asc" }, ...ITEM_ORDER],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { items: rows.map((i) => toPublicItemDto(i, lang, i.album)), meta: pageMeta(page, limit, total) };
}

// Tags des médias d'albums publiés, avec leur nombre d'usages (pour construire un filtre).
export async function tags() {
  return prismaRaw.$queryRaw`
    SELECT t AS tag, count(*)::int AS count
      FROM "gallery_items" i
      JOIN "gallery_albums" a ON a."id" = i."albumId", unnest(i."tags") AS t
     WHERE i."deletedAt" IS NULL AND a."deletedAt" IS NULL AND a."status" = 'PUBLISHED'
     GROUP BY t ORDER BY count DESC, t ASC LIMIT 500`;
}

// ---------------------------------------------------------------------------
// Albums liés à un événement (consultés depuis la page de l'événement)
// ---------------------------------------------------------------------------
export async function albumsOfEvent(eventSlug, lang, now = new Date()) {
  const translation = await prismaRaw.eventTranslation.findFirst({
    where: { slug: eventSlug, language: lang },
    include: { event: { include: { translations: true } } },
  });
  if (!translation || !isEventPublic(translation.event, now)) throw new AppError("Événement introuvable", HTTP_STATUS.NOT_FOUND);

  const albums = await prismaRaw.galleryAlbum.findMany({
    where: { ...publicAlbumWhere, linkedEventId: translation.event.id },
    include: ALBUM_INCLUDE,
    orderBy: ALBUM_ORDER.manual,
  });
  return {
    event: { id: translation.event.id, slug: translation.slug, title: translation.title },
    albums: albums.map((a) => toPublicAlbumDto(a, lang, now)),
  };
}
