import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import {
  adminListRules,
  createDailyMessageRules,
  scheduleRules,
  updateDailyMessageRules,
} from "../validators/dailyMessage.validator.js";
import * as c from "../controllers/dailyMessage.controller.js";

// Gestion des messages du jour : Admin et Super Admin.
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.get("/", adminListRules, validate, asyncHandler(c.adminList));
router.post("/", createDailyMessageRules, validate, asyncHandler(c.create));
router.get("/:id", idParam(), validate, asyncHandler(c.adminGet));
router.patch("/:id", idParam(), updateDailyMessageRules, validate, asyncHandler(c.update));
router.delete("/:id", idParam(), validate, asyncHandler(c.remove));

router.post("/:id/publish", idParam(), validate, asyncHandler(c.transition("publish", "Message publié")));
router.post("/:id/schedule", idParam(), scheduleRules, validate, asyncHandler(c.transition("schedule", "Publication programmée")));
router.post("/:id/unpublish", idParam(), validate, asyncHandler(c.transition("unpublish", "Message dépublié")));
router.post("/:id/archive", idParam(), validate, asyncHandler(c.transition("archive", "Message archivé")));
router.post("/:id/unarchive", idParam(), validate, asyncHandler(c.transition("unarchive", "Message désarchivé")));
router.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));

export default router;
