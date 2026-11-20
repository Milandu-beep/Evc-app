import { matchedData } from "express-validator";
import * as service from "../services/people/person.service.js";
import * as publicService from "../services/people/person.public.service.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs « optional({ nullable: true }) » reçus à null :
// on les relit dans le corps pour que « { "photoId": null } » (effacer la photo) soit pris en compte.
const NULLABLE_FIELDS = ["photoId"];

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

// --- Administration ---
export const adminList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await service.list({ page: q.page ?? 1, limit: q.limit ?? 20, q: q.q, status: q.status, category: q.category, deleted: q.deleted ?? false, sort: q.sort ?? "sortOrder", order: q.order ?? "asc" });
  sendPaginated(res, items, meta);
};
export const adminGet = async (req, res) => sendSuccess(res, await service.getById(req.params.id));
export const create = async (req, res) => sendCreated(res, await service.create(data(req), req), "Personne créée");
export const update = async (req, res) => sendSuccess(res, await service.update(req.params.id, data(req), req), "Personne modifiée");
export const transition = (action, message) => async (req, res) => sendSuccess(res, await service.transition(req.params.id, action, req), message);
export const remove = async (req, res) => { await service.remove(req.params.id, req); sendSuccess(res, null, "Personne supprimée"); };
export const restore = async (req, res) => sendSuccess(res, await service.restore(req.params.id, req), "Personne restaurée");

// --- Lecture publique ---
const cache = (res) => res.set("Cache-Control", "public, max-age=60");
export const publicList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.list({ lang: resolveLanguage(req), q: q.q, category: q.category, page: q.page ?? 1, limit: q.limit ?? 24 });
  cache(res);
  sendPaginated(res, items, meta);
};
export const publicDetail = async (req, res) => {
  const person = await publicService.getBySlug(req.params.slug, resolveLanguage(req));
  cache(res);
  sendSuccess(res, person);
};
