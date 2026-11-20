import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import { adminListRules, createNewsRules, scheduleRules, updateNewsRules } from "../validators/news.validator.js";
import * as c from "../controllers/news.controller.js";

// Gestion des actualités : Admin et Super Admin.
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.get("/", adminListRules, validate, asyncHandler(c.adminList));
router.post("/", createNewsRules, validate, asyncHandler(c.create));
router.get("/:id", idParam(), validate, asyncHandler(c.adminGet));
router.patch("/:id", idParam(), updateNewsRules, validate, asyncHandler(c.update));
router.delete("/:id", idParam(), validate, asyncHandler(c.remove));

router.post("/:id/publish", idParam(), validate, asyncHandler(c.transition("publish", "Actualité publiée")));
router.post("/:id/schedule", idParam(), scheduleRules, validate, asyncHandler(c.transition("schedule", "Publication programmée")));
router.post("/:id/unpublish", idParam(), validate, asyncHandler(c.transition("unpublish", "Actualité dépubliée")));
router.post("/:id/archive", idParam(), validate, asyncHandler(c.transition("archive", "Actualité archivée")));
router.post("/:id/unarchive", idParam(), validate, asyncHandler(c.transition("unarchive", "Actualité désarchivée")));
router.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));

export default router;
