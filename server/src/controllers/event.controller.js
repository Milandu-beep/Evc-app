import { matchedData } from "express-validator";
import * as eventService from "../services/events/event.service.js";
import * as publicService from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// Corps validé, sans traductions « fantômes » : une langue absente ou vide est ignorée,
// « null » (suppression explicite d'une langue) est conservé.
function data(req) {
  const body = matchedData(req, { locations: ["body"] });
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
  const { items, meta } = await eventService.list({
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    q: q.q,
    state: q.state,
    featured: q.featured,
    from: q.from,
    to: q.to,
    registrationRequired: q.registrationRequired,
    deleted: q.deleted ?? false,
    sort: q.sort ?? "startsAt",
    order: q.order ?? "desc",
  });
  sendPaginated(res, items, meta);
};

export const adminGet = async (req, res) => sendSuccess(res, await eventService.getById(req.params.id, { includeDeleted: true }));

export const create = async (req, res) =>
  sendCreated(res, await eventService.create(data(req), req), "Événement créé");

export const update = async (req, res) =>
  sendSuccess(res, await eventService.update(req.params.id, data(req), req), "Événement modifié");

// POST /:id/publish | schedule | unpublish | cancel | archive | unarchive
export const transition = (action, message) => async (req, res) =>
  sendSuccess(res, await eventService.transition(req.params.id, action, data(req), req), message);

export const remove = async (req, res) => {
  await eventService.remove(req.params.id, req);
  sendSuccess(res, null, "Événement supprimé");
};

export const restore = async (req, res) =>
  sendSuccess(res, await eventService.restore(req.params.id, req), "Événement restauré");

// ---------------------------------------------------------------------------
// Lecture publique (sans authentification)
// ---------------------------------------------------------------------------
const cache = (res) => res.set("Cache-Control", "public, max-age=60");

export const publicList = async (req, res) => {
  const q = params(req);
  const { items, meta } = await publicService.list({
    lang: publicService.resolveLanguage(req),
    q: q.q,
    when: q.when ?? "upcoming",
    featured: q.featured,
    page: q.page ?? 1,
    limit: q.limit ?? 12,
  });
  cache(res);
  sendPaginated(res, items, meta);
};

export const publicDetail = async (req, res) => {
  const event = await publicService.getBySlug(req.params.slug, publicService.resolveLanguage(req));
  cache(res);
  sendSuccess(res, event);
};
