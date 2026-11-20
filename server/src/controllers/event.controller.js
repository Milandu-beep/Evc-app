import { matchedData } from "express-validator";
import * as eventService from "../services/events/event.service.js";
import * as publicService from "../services/events/event.public.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs scalaires « optional({ nullable: true }) » reçus à null :
// sans ce rattrapage, « { "capacity": null } » (effacer une valeur) serait silencieusement ignoré.
// Ces clés ont déjà été validées (null accepté) ; on les relit dans le corps de la requête.
const NULLABLE_FIELDS = ["endsAt", "coverImageId", "capacity", "color", "icon", "registrationUrl"];

// Corps validé, sans traductions « fantômes » : une langue absente ou vide est ignorée,
// « null » (suppression explicite d'une langue) est conservé.
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
  const { items, meta } = await eventService.list({
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    q: q.q,
    state: q.state,
    type: q.type,
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
    type: q.type,
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

// GET /api/events/calendar?month=2026-12  ou  ?from=…&to=…  (+ lang, type)
export const publicCalendar = async (req, res) => {
  const q = params(req);
  const data = await publicService.calendar({
    lang: publicService.resolveLanguage(req),
    type: q.type,
    month: q.month,
    from: q.from,
    to: q.to,
  });
  cache(res);
  sendSuccess(res, data);
};
