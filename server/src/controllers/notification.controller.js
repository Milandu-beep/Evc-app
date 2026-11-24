import { matchedData } from "express-validator";
import env from "../config/env.js";
import { NOTIFICATION } from "../config/notifications.js";
import { LANGUAGES } from "../config/constants.js";
import * as service from "../services/notifications/notification.service.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// Corps validé, sans traductions « fantômes » (langue absente ou vide ignorée, null = retirer la langue)
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

// --- Administration ---
export const list = async (req, res) => {
  const q = params(req);
  const { items, meta } = await service.list({
    page: q.page ?? 1, limit: q.limit ?? 20, q: q.q, status: q.status, type: q.type, audience: q.audience,
    from: q.from, to: q.to, deleted: q.deleted ?? false, sort: q.sort ?? "createdAt", order: q.order ?? "desc",
  });
  sendPaginated(res, items, meta);
};
export const get = async (req, res) => sendSuccess(res, await service.getById(req.params.id));
export const history = async (req, res) => {
  const q = params(req);
  const { items, meta } = await service.history(req.params.id, { page: q.page ?? 1, limit: q.limit ?? 50 });
  sendPaginated(res, items, meta);
};
export const create = async (req, res) => sendCreated(res, await service.create(data(req), req), "Notification créée");
export const update = async (req, res) => sendSuccess(res, await service.update(req.params.id, data(req), req), "Notification modifiée");
export const schedule = async (req, res) => sendSuccess(res, await service.schedule(req.params.id, data(req).scheduledAt, req), "Notification planifiée");
export const sendNow = async (req, res) => sendSuccess(res, await service.sendNow(req.params.id, req), "Envoi demandé");
export const cancel = async (req, res) => sendSuccess(res, await service.cancel(req.params.id, data(req).reason, req), "Notification annulée");
export const retry = async (req, res) => sendSuccess(res, await service.retry(req.params.id, req), "Notification relancée");
export const remove = async (req, res) => { await service.remove(req.params.id, req); sendSuccess(res, null, "Notification supprimée"); };
export const restore = async (req, res) => sendSuccess(res, await service.restore(req.params.id, req), "Notification restaurée");
export const provider = async (req, res) => sendSuccess(res, service.providerStatus());
export const test = async (req, res) => sendCreated(res, await service.sendTest(data(req), req), "Notification de test envoyée");

// --- Public : de quoi initialiser l'abonnement côté application (l'identifiant d'application OneSignal est public) ---
export const publicConfig = async (req, res) => {
  const status = service.providerStatus();
  res.set("Cache-Control", "public, max-age=300");
  sendSuccess(res, {
    enabled: status.enabled,
    provider: status.provider,
    ...(status.provider === "onesignal" && status.enabled && { appId: env.notifications.onesignal.appId }),
    languages: Object.values(LANGUAGES),
    audiences: NOTIFICATION.AUDIENCES,
  });
};
