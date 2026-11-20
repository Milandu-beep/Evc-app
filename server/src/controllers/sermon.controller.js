import { matchedData } from "express-validator";
import * as sermons from "../services/sermons/sermon.service.js";
import * as seriesService from "../services/sermons/series.service.js";
import * as publicService from "../services/sermons/sermon.public.service.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs « optional({ nullable: true }) » reçus à null :
// on les relit dans le corps pour que « { "audioFileId": null } » (effacer) soit pris en compte.
const NULLABLE_FIELDS = ["seriesId", "seriesPosition", "coverImageId", "audioFileId", "videoFileId", "youtubeUrl", "preacherId"];

function data(req) {
  const body = matchedData(req, { locations: ["body"] });
  for (const key of NULLABLE_FIELDS) if (req.body?.[key] === null) body[key] = null;
  if (body.translations) {
    const cleaned = {};
    for (const [lang, value] of Object.entries(body.translations)) {
      if (value === null) cleaned[lang] = null;
      else if (value && typeof value === "object") {
        const fields = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
        if (Object.keys(fields).length) cleaned[lang] = fields;
      }
    }
    body.translations = cleaned;
  }
  return body;
}
const params = (req) => matchedData(req, { locations: ["query"] });

// Filtres communs des listes de prédications
const sermonQuery = (q) => ({
  q: q.q, tags: q.tags, match: q.match ?? "all", theme: q.theme, verse: q.verse, seriesId: q.seriesId, series: q.series,
  speakerId: q.speakerId, role: q.role, featured: q.featured, hasAudio: q.hasAudio, hasVideo: q.hasVideo, from: q.from, to: q.to,
});

// ---------------------------------------------------------------------------
// Administration : prédications
// ---------------------------------------------------------------------------
export const adminList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await sermons.list({ ...sermonQuery(q), page: q.page ?? 1, limit: q.limit ?? 20, state: q.state, deleted: q.deleted ?? false, sort: q.sort ?? "date", order: q.order ?? "desc" });
  sendPaginated(res, items, meta);
};
export const adminGet = async (req, res) => sendSuccess(res, await sermons.getById(req.params.id));
export const create = async (req, res) => sendCreated(res, await sermons.create(data(req), req), "Prédication créée");
export const update = async (req, res) => sendSuccess(res, await sermons.update(req.params.id, data(req), req), "Prédication modifiée");
export const transition = (action, message) => async (req, res) => sendSuccess(res, await sermons.transition(req.params.id, action, data(req), req), message);
export const remove = async (req, res) => { await sermons.remove(req.params.id, req); sendSuccess(res, null, "Prédication supprimée"); };
export const restore = async (req, res) => sendSuccess(res, await sermons.restore(req.params.id, req), "Prédication restaurée");
export const adminTags = async (req, res) => sendSuccess(res, await sermons.tags());

// Documents
export const documentsAdd = async (req, res) => sendCreated(res, await sermons.addDocuments(req.params.id, data(req).documents, req), "Documents ajoutés");
export const documentUpdate = async (req, res) => sendSuccess(res, await sermons.updateDocument(req.params.docId, data(req), req), "Document modifié");
export const documentRemove = async (req, res) => { await sermons.removeDocument(req.params.docId, req); sendSuccess(res, null, "Document retiré"); };
export const documentsReorder = async (req, res) => { await sermons.reorderDocuments(req.params.id, data(req).documentIds, req); sendSuccess(res, null, "Ordre des documents enregistré"); };

// ---------------------------------------------------------------------------
// Administration : séries
// ---------------------------------------------------------------------------
export const seriesList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await seriesService.list({ page: q.page ?? 1, limit: q.limit ?? 20, q: q.q, status: q.status, featured: q.featured, deleted: q.deleted ?? false, sort: q.sort ?? "sortOrder", order: q.order ?? "asc" });
  sendPaginated(res, items, meta);
};
export const seriesGet = async (req, res) => sendSuccess(res, await seriesService.getById(req.params.id));
export const seriesCreate = async (req, res) => sendCreated(res, await seriesService.create(data(req), req), "Série créée");
export const seriesUpdate = async (req, res) => sendSuccess(res, await seriesService.update(req.params.id, data(req), req), "Série modifiée");
export const seriesTransition = (action, message) => async (req, res) => sendSuccess(res, await seriesService.transition(req.params.id, action, req), message);
export const seriesRemove = async (req, res) => { await seriesService.remove(req.params.id, req); sendSuccess(res, null, "Série supprimée"); };
export const seriesRestore = async (req, res) => sendSuccess(res, await seriesService.restore(req.params.id, req), "Série restaurée");

// ---------------------------------------------------------------------------
// Lecture publique
// ---------------------------------------------------------------------------
const cache = (res) => res.set("Cache-Control", "public, max-age=60");

export const publicList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.list({ ...sermonQuery(q), lang: resolveLanguage(req), page: q.page ?? 1, limit: q.limit ?? 12, sort: q.sort ?? "recent" });
  cache(res);
  sendPaginated(res, items, meta);
};
export const publicDetail = async (req, res) => {
  const s = await publicService.getBySlug(req.params.slug, resolveLanguage(req));
  cache(res);
  sendSuccess(res, s);
};
export const publicTags = async (req, res) => { const t = await publicService.tags(); cache(res); sendSuccess(res, t); };

// POST /:id/{views,plays,downloads} : jamais mis en cache
export const publicCount = (type) => async (req, res) => sendSuccess(res, await publicService.count(req.params.id, type, req.ip), "OK");

export const publicSeriesList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.listSeries({ lang: resolveLanguage(req), q: q.q, featured: q.featured, page: q.page ?? 1, limit: q.limit ?? 12 });
  cache(res);
  sendPaginated(res, items, meta);
};
export const publicSeriesDetail = async (req, res) => {
  const q = params(req);
  const result = await publicService.getSeriesBySlug(req.params.slug, { lang: resolveLanguage(req), page: q.page ?? 1, limit: q.limit ?? 50 });
  cache(res);
  res.json({ success: true, message: "OK", data: { ...result.series, sermons: result.items }, meta: result.meta });
};
