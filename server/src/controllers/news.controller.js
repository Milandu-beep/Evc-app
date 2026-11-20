import { matchedData } from "express-validator";
import * as newsService from "../services/news/news.service.js";
import * as publicService from "../services/news/news.public.service.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs scalaires « optional({ nullable: true }) » reçus à null :
// sans ce rattrapage, « { "capacity": null } » (effacer une valeur) serait silencieusement ignoré.
// Ces clés ont déjà été validées (null accepté) ; on les relit dans le corps de la requête.
const NULLABLE_FIELDS = ["coverImageId"];

// Corps validé, sans traductions « fantômes » (langue absente ou vide ignorée, null = suppression).
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

// ---------------------------------------------------------------------------
// Administration (Admin et Super Admin)
// ---------------------------------------------------------------------------
export const adminList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await newsService.list({
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    q: q.q,
    state: q.state,
    featured: q.featured,
    from: q.from,
    to: q.to,
    deleted: q.deleted ?? false,
    sort: q.sort ?? "createdAt",
    order: q.order ?? "desc",
  });
  sendPaginated(res, items, meta);
};

export const adminGet = async (req, res) => sendSuccess(res, await newsService.getById(req.params.id));
export const create = async (req, res) => sendCreated(res, await newsService.create(data(req), req), "Actualité créée");
export const update = async (req, res) => sendSuccess(res, await newsService.update(req.params.id, data(req), req), "Actualité modifiée");

// POST /:id/publish | schedule | unpublish | archive | unarchive
export const transition = (action, message) => async (req, res) =>
  sendSuccess(res, await newsService.transition(req.params.id, action, data(req), req), message);

export const remove = async (req, res) => {
  await newsService.remove(req.params.id, req);
  sendSuccess(res, null, "Actualité supprimée");
};
export const restore = async (req, res) => sendSuccess(res, await newsService.restore(req.params.id, req), "Actualité restaurée");

// ---------------------------------------------------------------------------
// Lecture publique (sans authentification)
// ---------------------------------------------------------------------------
const cache = (res) => res.set("Cache-Control", "public, max-age=60");

export const publicList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.list({
    lang: resolveLanguage(req),
    q: q.q,
    featured: q.featured,
    from: q.from,
    to: q.to,
    page: q.page ?? 1,
    limit: q.limit ?? 12,
  });
  cache(res);
  sendPaginated(res, items, meta);
};

export const publicDetail = async (req, res) => {
  const news = await publicService.getBySlug(req.params.slug, resolveLanguage(req));
  cache(res);
  sendSuccess(res, news);
};
