import { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { TtlSet } from "../../utils/ttlSet.js";
import { pageMeta } from "../content/common.js";
import { publicVisibility } from "../content/lifecycle.js";
import { SERIES_INCLUDE, SERMON_INCLUDE, seriesAdminInclude, toPublicSeriesDto, toPublicSermonDetailDto, toPublicSermonListDto } from "./sermon.dto.js";
import { sermonFilters } from "./sermon.filters.js";

const ORDER = {
  recent: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  oldest: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  popular: [{ playCount: "desc" }, { viewCount: "desc" }, { date: "desc" }, { id: "asc" }],
};
const visible = (now) => ({ deletedAt: null, AND: [publicVisibility(now)] });

// ---------------------------------------------------------------------------
// Prédications
// ---------------------------------------------------------------------------
export async function list(query, now = new Date()) {
  const { lang, page, limit, sort } = query;
  const and = [publicVisibility(now), ...(await sermonFilters(query))];
  const where = { deletedAt: null, AND: and };
  const [total, rows] = await Promise.all([
    prismaRaw.sermon.count({ where }),
    prismaRaw.sermon.findMany({ where, include: SERMON_INCLUDE, orderBy: ORDER[sort], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((s) => toPublicSermonListDto(s, lang)), meta: pageMeta(page, limit, total) };
}

export async function getBySlug(slug, lang, now = new Date()) {
  const t = await prismaRaw.sermonTranslation.findFirst({
    where: { slug, language: lang, sermon: visible(now) },
    include: { sermon: { include: SERMON_INCLUDE } },
  });
  if (!t) throw new AppError("Prédication introuvable", HTTP_STATUS.NOT_FOUND);
  return toPublicSermonDetailDto(t.sermon, lang);
}

// Tags des prédications publiées, avec leur nombre d'usages (pour construire un filtre).
export async function tags(now = new Date()) {
  return prismaRaw.$queryRaw`
    SELECT t AS tag, count(*)::int AS count FROM "sermons" s, unnest(s."tags") AS t
     WHERE s."deletedAt" IS NULL
       AND (s."status" = 'PUBLISHED' OR (s."status" = 'SCHEDULED' AND s."publishAt" <= ${now}))
     GROUP BY t ORDER BY count DESC, t ASC LIMIT 500`;
}

// ---------------------------------------------------------------------------
// Compteurs (vues, écoutes, téléchargements). Comptés au plus une fois par visiteur (IP) et par période,
// puis incrémentés de façon atomique en base. Le cache anti-doublon est en mémoire : il suppose une seule
// instance du serveur (avec plusieurs instances, un visiteur peut être compté une fois par instance).
// ---------------------------------------------------------------------------
const COLUMNS = { view: "viewCount", play: "playCount", download: "downloadCount" };
const DEDUPE_MS = 30 * 60 * 1000;
export const counterDedupe = new TtlSet({ ttlMs: DEDUPE_MS });

export async function count(sermonId, type, ip, now = new Date()) {
  const column = COLUMNS[type];
  const sermon = await prismaRaw.sermon.findFirst({ where: { id: sermonId, ...visible(now) }, select: { id: true, viewCount: true, playCount: true, downloadCount: true } });
  if (!sermon) throw new AppError("Prédication introuvable", HTTP_STATUS.NOT_FOUND);

  const isNew = counterDedupe.add(`${ip}|${sermonId}|${type}`);
  if (!isNew) return { counted: false, stats: { views: sermon.viewCount, plays: sermon.playCount, downloads: sermon.downloadCount } };

  const updated = await prismaRaw.sermon.update({ where: { id: sermonId }, data: { [column]: { increment: 1 } }, select: { viewCount: true, playCount: true, downloadCount: true } });
  return { counted: true, stats: { views: updated.viewCount, plays: updated.playCount, downloads: updated.downloadCount } };
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------
const publicSeriesWhere = { deletedAt: null, status: "PUBLISHED" };

export async function listSeries({ lang, q, featured, page, limit }, now = new Date()) {
  const and = [];
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (q) and.push({ translations: { some: { OR: ["title", "description"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } });
  const where = { ...publicSeriesWhere, ...(and.length && { AND: and }) };
  const include = seriesAdminInclude(visible(now)); // sermonCount : prédications visibles
  const [total, rows] = await Promise.all([
    prismaRaw.sermonSeries.count({ where }),
    prismaRaw.sermonSeries.findMany({ where, include, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((s) => toPublicSeriesDto(s, lang)), meta: pageMeta(page, limit, total) };
}

// Détail d'une série et de ses prédications (dans l'ordre de la série : numéro, puis date).
export async function getSeriesBySlug(slug, { lang, page, limit }, now = new Date()) {
  const t = await prismaRaw.sermonSeriesTranslation.findFirst({
    where: { slug, language: lang, series: publicSeriesWhere },
    include: { series: { include: seriesAdminInclude(visible(now)) } },
  });
  if (!t) throw new AppError("Série introuvable", HTTP_STATUS.NOT_FOUND);
  const where = { ...visible(now), seriesId: t.series.id };
  const [total, rows] = await Promise.all([
    prismaRaw.sermon.count({ where }),
    prismaRaw.sermon.findMany({
      where,
      include: SERMON_INCLUDE,
      orderBy: [{ seriesPosition: { sort: "asc", nulls: "last" } }, { date: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { series: toPublicSeriesDto(t.series, lang), items: rows.map((s) => toPublicSermonListDto(s, lang)), meta: pageMeta(page, limit, total) };
}

export { SERIES_INCLUDE };
