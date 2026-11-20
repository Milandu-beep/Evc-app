import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import {
  adminListRules,
  cancelRules,
  createEventRules,
  scheduleRules,
  updateEventRules,
} from "../validators/event.validator.js";
import * as c from "../controllers/event.controller.js";

// Gestion des événements : Admin et Super Admin.
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.get("/", adminListRules, validate, asyncHandler(c.adminList));
router.post("/", createEventRules, validate, asyncHandler(c.create));
router.get("/:id", idParam(), validate, asyncHandler(c.adminGet));
router.patch("/:id", idParam(), updateEventRules, validate, asyncHandler(c.update));
router.delete("/:id", idParam(), validate, asyncHandler(c.remove));

router.post("/:id/publish", idParam(), validate, asyncHandler(c.transition("publish", "Événement publié")));
router.post("/:id/schedule", idParam(), scheduleRules, validate, asyncHandler(c.transition("schedule", "Publication programmée")));
router.post("/:id/unpublish", idParam(), validate, asyncHandler(c.transition("unpublish", "Événement dépublié")));
router.post("/:id/cancel", idParam(), cancelRules, validate, asyncHandler(c.transition("cancel", "Événement annulé")));
router.post("/:id/archive", idParam(), validate, asyncHandler(c.transition("archive", "Événement archivé")));
router.post("/:id/unarchive", idParam(), validate, asyncHandler(c.transition("unarchive", "Événement désarchivé")));
router.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));

export default router;
