import { matchedData } from "express-validator";
import * as service from "../services/dailyMessages/dailyMessage.service.js";
import * as publicService from "../services/dailyMessages/dailyMessage.public.service.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs scalaires « optional({ nullable: true }) » reçus à null :
// on les relit dans le corps pour que « { "imageId": null } » (effacer l'image) soit pris en compte.
const NULLABLE_FIELDS = ["imageId"];

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
  const { items, meta } = await service.list({
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    q: q.q,
    state: q.state,
    theme: q.theme,
    from: q.from,
    to: q.to,
    deleted: q.deleted ?? false,
    sort: q.sort ?? "date",
    order: q.order ?? "desc",
  });
  sendPaginated(res, items, meta);
};

export const adminGet = async (req, res) => sendSuccess(res, await service.getById(req.params.id));
export const create = async (req, res) => sendCreated(res, await service.create(data(req), req), "Message créé");
export const update = async (req, res) => sendSuccess(res, await service.update(req.params.id, data(req), req), "Message modifié");

// POST /:id/publish | schedule | unpublish | archive | unarchive
export const transition = (action, message) => async (req, res) =>
  sendSuccess(res, await service.transition(req.params.id, action, data(req), req), message);

export const remove = async (req, res) => {
  await service.remove(req.params.id, req);
  sendSuccess(res, null, "Message supprimé");
};
export const restore = async (req, res) => sendSuccess(res, await service.restore(req.params.id, req), "Message restauré");

// ---------------------------------------------------------------------------
// Lecture publique (sans authentification)
// ---------------------------------------------------------------------------
const cache = (res) => res.set("Cache-Control", "public, max-age=60");

export const publicToday = async (req, res) => {
  const message = await publicService.getToday(resolveLanguage(req));
  cache(res);
  sendSuccess(res, message);
};

export const publicByDate = async (req, res) => {
  const message = await publicService.getByDate(req.params.date, resolveLanguage(req));
  cache(res);
  sendSuccess(res, message);
};

export const publicList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.list({
    lang: resolveLanguage(req),
    q: q.q,
    theme: q.theme,
    from: q.from,
    to: q.to,
    page: q.page ?? 1,
    limit: q.limit ?? 12,
  });
  cache(res);
  sendPaginated(res, items, meta);
};
