import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { counterLimiter, publicLimiter } from "../middleware/rateLimit.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import {
  addDocumentsRules, adminSermonListRules, adminSeriesListRules, createSermonRules, createSeriesRules,
  publicSeriesDetailRules, publicSeriesListRules, publicSermonDetailRules, publicSermonListRules,
  reorderDocumentsRules, scheduleRules, updateDocumentRules, updateSermonRules, updateSeriesRules,
} from "../validators/sermon.validator.js";
import * as c from "../controllers/sermon.controller.js";

const adminOnly = [authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN)];
const t = (router, action, label) => router.post(`/:id/${action}`, idParam(), validate, asyncHandler(c.transition(action, label)));

// ---------------------------------------------------------------------------
// Lecture publique : /api/sermons
// ---------------------------------------------------------------------------
export const publicSermons = Router();
publicSermons.get("/", publicLimiter, publicSermonListRules, validate, asyncHandler(c.publicList));
publicSermons.get("/tags", publicLimiter, asyncHandler(c.publicTags)); // avant /:slug
// Compteurs : POST (jamais mis en cache), limités par IP et dédoublonnés par visiteur
publicSermons.post("/:id/views", counterLimiter, idParam(), validate, asyncHandler(c.publicCount("view")));
publicSermons.post("/:id/plays", counterLimiter, idParam(), validate, asyncHandler(c.publicCount("play")));
publicSermons.post("/:id/downloads", counterLimiter, idParam(), validate, asyncHandler(c.publicCount("download")));
publicSermons.get("/:slug", publicLimiter, publicSermonDetailRules, validate, asyncHandler(c.publicDetail));

// Lecture publique : /api/sermon-series
export const publicSeries = Router();
publicSeries.use(publicLimiter);
publicSeries.get("/", publicSeriesListRules, validate, asyncHandler(c.publicSeriesList));
publicSeries.get("/:slug", publicSeriesDetailRules, validate, asyncHandler(c.publicSeriesDetail));

// ---------------------------------------------------------------------------
// Administration : /api/admin/sermons
// ---------------------------------------------------------------------------
export const adminSermons = Router();
adminSermons.use(...adminOnly);
adminSermons.get("/", adminSermonListRules, validate, asyncHandler(c.adminList));
adminSermons.post("/", createSermonRules, validate, asyncHandler(c.create));
adminSermons.get("/tags", asyncHandler(c.adminTags));
adminSermons.patch("/documents/:docId", idParam("docId"), updateDocumentRules, validate, asyncHandler(c.documentUpdate));
adminSermons.delete("/documents/:docId", idParam("docId"), validate, asyncHandler(c.documentRemove));
adminSermons.get("/:id", idParam(), validate, asyncHandler(c.adminGet));
adminSermons.patch("/:id", idParam(), updateSermonRules, validate, asyncHandler(c.update));
adminSermons.delete("/:id", idParam(), validate, asyncHandler(c.remove));
adminSermons.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));
adminSermons.post("/:id/schedule", idParam(), scheduleRules, validate, asyncHandler(c.transition("schedule", "Publication programmée")));
t(adminSermons, "publish", "Prédication publiée");
t(adminSermons, "unpublish", "Prédication dépubliée");
t(adminSermons, "archive", "Prédication archivée");
t(adminSermons, "unarchive", "Prédication désarchivée");
adminSermons.post("/:id/documents", idParam(), addDocumentsRules, validate, asyncHandler(c.documentsAdd));
adminSermons.put("/:id/documents/order", idParam(), reorderDocumentsRules, validate, asyncHandler(c.documentsReorder));

// Administration : /api/admin/sermon-series
export const adminSeries = Router();
adminSeries.use(...adminOnly);
adminSeries.get("/", adminSeriesListRules, validate, asyncHandler(c.seriesList));
adminSeries.post("/", createSeriesRules, validate, asyncHandler(c.seriesCreate));
adminSeries.get("/:id", idParam(), validate, asyncHandler(c.seriesGet));
adminSeries.patch("/:id", idParam(), updateSeriesRules, validate, asyncHandler(c.seriesUpdate));
adminSeries.delete("/:id", idParam(), validate, asyncHandler(c.seriesRemove));
adminSeries.post("/:id/restore", idParam(), validate, asyncHandler(c.seriesRestore));
for (const [action, label] of [["publish", "Série publiée"], ["unpublish", "Série dépubliée"], ["archive", "Série archivée"], ["unarchive", "Série désarchivée"]]) {
  adminSeries.post(`/:id/${action}`, idParam(), validate, asyncHandler(c.seriesTransition(action, label)));
}
