import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { coverDto, excerptOf } from "../content/dto.js";
import { computeState } from "../content/lifecycle.js";
import { dateString } from "../dailyMessages/dailyMessage.state.js";
import { fullName, toPersonRefDto } from "../people/person.dto.js";
import { urlFor } from "../storage/storage.service.js";
import { baseName, youtubeDto } from "./sermon.common.js";

// Relations chargées avec une prédication
export const SERMON_INCLUDE = {
  translations: true,
  coverImage: true,
  audioFile: true,
  videoFile: true,
  series: { include: { translations: true, coverImage: true } },
  speakers: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { person: { include: { translations: true, photo: true } } } },
  documents: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { translations: true, storageFile: true } },
};

const pickLang = (translations, language) =>
  translations.find((t) => t.language === language) ?? translations.find((t) => t.language === DEFAULT_LANGUAGE) ?? translations[0];

// Fichier média (audio ou vidéo) : URL calculées, durée.
function mediaDto(file, { thumbnail = false } = {}) {
  if (!file || file.status !== "READY") return null;
  return {
    url: urlFor(file),
    ...(thumbnail && { thumbnailUrl: urlFor(file, { thumbnail: true }) }),
    duration: file.duration, // secondes
    bytes: file.bytes,
    mimeType: file.mimeType,
    ...(thumbnail && { width: file.width, height: file.height }),
  };
}

export const durationOf = (s) => s.audioFile?.duration ?? s.videoFile?.duration ?? null;
const stats = (s) => ({ views: s.viewCount, plays: s.playCount, downloads: s.downloadCount });
const seriesIsPublic = (series) => !!series && series.status === "PUBLISHED" && !series.deletedAt;

// Couverture : l'image choisie, sinon la miniature YouTube, sinon celle de la vidéo hébergée, sinon celle de la série.
function effectiveCover(s) {
  if (s.coverImage) return coverDto(s.coverImage);
  if (s.youtubeId) return { url: youtubeDto(s.youtubeId).thumbnailUrl, thumbnailUrl: youtubeDto(s.youtubeId).thumbnailUrl };
  if (s.videoFile?.status === "READY") return coverDto(s.videoFile);
  if (seriesIsPublic(s.series)) return coverDto(s.series.coverImage);
  return null;
}

const documentDto = (d, language) => {
  const t = pickLang(d.translations, language);
  return {
    id: d.id,
    position: d.position,
    title: t?.title ?? baseName(d.storageFile?.originalFilename),
    url: d.storageFile?.status === "READY" ? urlFor(d.storageFile) : null,
    bytes: d.storageFile?.bytes ?? null,
  };
};

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
export function toAdminSermonDto(s, now = new Date()) {
  const fr = s.series ? pickLang(s.series.translations, DEFAULT_LANGUAGE) : null;
  return {
    id: s.id,
    status: s.status,
    state: computeState(s, now),
    date: dateString(s.date),
    series: s.series ? { id: s.series.id, status: s.series.status, title: fr?.title ?? null } : null,
    seriesPosition: s.seriesPosition,
    coverImage: coverDto(s.coverImage),
    cover: effectiveCover(s),
    audio: s.audioFile ? { id: s.audioFileId, ...mediaDto(s.audioFile) } : null,
    video: s.videoFile ? { id: s.videoFileId, ...mediaDto(s.videoFile, { thumbnail: true }) } : null,
    youtube: youtubeDto(s.youtubeId) || null,
    durationSeconds: durationOf(s),
    documents: s.documents.map((d) => ({
      id: d.id,
      position: d.position,
      fileId: d.storageFileId,
      originalFilename: d.storageFile?.originalFilename,
      bytes: d.storageFile?.bytes,
      url: d.storageFile?.status === "READY" ? urlFor(d.storageFile) : null,
      translations: Object.fromEntries(d.translations.map((t) => [t.language, { title: t.title }])),
    })),
    speakers: s.speakers.map((x) => ({ id: x.id, role: x.role, position: x.position, person: { id: x.person.id, name: fullName(x.person), status: x.person.status } })),
    tags: s.tags,
    isFeatured: s.isFeatured,
    notifyOnPublish: s.notifyOnPublish,
    publishAt: s.publishAt,
    publishedAt: s.publishedAt,
    stats: stats(s),
    translations: Object.fromEntries(
      s.translations.map((t) => [t.language, { slug: t.slug, title: t.title, description: t.description, theme: t.theme, verseReferences: t.verseReferences }])
    ),
    createdById: s.createdById,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
  };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
function speakersDto(s, language) {
  return s.speakers.map((x) => ({ role: x.role, person: toPersonRefDto(x.person, language) }));
}

function baseDto(s, language) {
  const t = pickLang(s.translations, language);
  const speakers = speakersDto(s, language);
  const series = seriesIsPublic(s.series) ? pickLang(s.series.translations, language) : null;
  return {
    id: s.id,
    slug: t.slug,
    language: t.language,
    title: t.title,
    theme: t.theme,
    verseReferences: t.verseReferences,
    date: dateString(s.date),
    series: series ? { id: s.series.id, slug: series.slug, title: series.title } : null,
    seriesPosition: series ? s.seriesPosition : null,
    // « preacher » : raccourci pour l'interface actuelle (un seul prédicateur) ; « speakers » donne tous les rôles
    preacher: speakers.find((x) => x.role === "PREACHER")?.person ?? null,
    speakers,
    cover: effectiveCover(s),
    hasAudio: !!s.audioFile,
    hasVideo: !!s.videoFile || !!s.youtubeId,
    durationSeconds: durationOf(s),
    tags: s.tags,
    isFeatured: s.isFeatured,
    stats: stats(s),
    availableLanguages: s.translations.map((x) => x.language),
    alternates: Object.fromEntries(s.translations.map((x) => [x.language, x.slug])),
  };
}

// Liste : extrait de la description seulement.
export function toPublicSermonListDto(s, language) {
  const t = pickLang(s.translations, language);
  return { ...baseDto(s, language), excerpt: excerptOf(null, t.description) };
}

// Détail : description complète, médias, documents. Aucun champ interne (statut, auteur, notification).
export function toPublicSermonDetailDto(s, language) {
  const t = pickLang(s.translations, language);
  return {
    ...baseDto(s, language),
    description: t.description,
    audio: mediaDto(s.audioFile),
    video: s.videoFile ? mediaDto(s.videoFile, { thumbnail: true }) : null,
    youtube: youtubeDto(s.youtubeId) || null,
    documents: s.documents.map((d) => documentDto(d, language)),
  };
}

// --- Séries ---
export const SERIES_INCLUDE = { translations: true, coverImage: true };
export const seriesAdminInclude = (sermonWhere) => ({ ...SERIES_INCLUDE, _count: { select: { sermons: { where: sermonWhere } } } });

export function toAdminSeriesDto(s) {
  return {
    id: s.id,
    status: s.status,
    sortOrder: s.sortOrder,
    isFeatured: s.isFeatured,
    coverImage: coverDto(s.coverImage),
    sermonCount: s._count?.sermons ?? 0,
    publishedAt: s.publishedAt,
    translations: Object.fromEntries(s.translations.map((t) => [t.language, { slug: t.slug, title: t.title, description: t.description }])),
    createdById: s.createdById,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
  };
}

export function toPublicSeriesDto(s, language) {
  const t = pickLang(s.translations, language);
  return {
    id: s.id,
    slug: t.slug,
    language: t.language,
    title: t.title,
    description: t.description,
    isFeatured: s.isFeatured,
    cover: coverDto(s.coverImage),
    sermonCount: s._count?.sermons ?? 0,
    availableLanguages: s.translations.map((x) => x.language),
    alternates: Object.fromEntries(s.translations.map((x) => [x.language, x.slug])),
  };
}
