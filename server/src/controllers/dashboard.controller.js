import { matchedData } from "express-validator";
import * as dashboardService from "../services/dashboard/dashboard.service.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import { sendPaginated, sendSuccess } from "../utils/response.js";

const params = (req) => matchedData(req, { locations: ["query"] });
// L'administration voit toujours l'état réel : aucune mise en cache.
const noStore = (res) => res.set("Cache-Control", "no-store");

// GET /admin/dashboard : indicateurs, alertes, agenda
export const overview = async (req, res) => {
  const q = params(req);
  const data = await dashboardService.overview({ language: resolveLanguage(req), days: q.days, role: req.user.role });
  noStore(res);
  sendSuccess(res, data);
};

// GET /admin/dashboard/activity : journal d'audit paginé
export const activity = async (req, res) => {
  const q = params(req);
  const { items, meta } = await dashboardService.activity({
    page: q.page ?? 1,
    limit: q.limit,
    entity: q.entity,
    action: q.action,
    adminId: q.adminId,
    from: q.from,
    to: q.to,
    role: req.user.role,
  });
  noStore(res);
  sendPaginated(res, items, meta);
};
