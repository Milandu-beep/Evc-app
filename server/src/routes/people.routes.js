import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import { adminPersonListRules, createPersonRules, publicPersonDetailRules, publicPersonListRules, updatePersonRules } from "../validators/person.validator.js";
import * as c from "../controllers/person.controller.js";

// Lecture publique (sans authentification) : /api/people
export const publicRouter = Router();
publicRouter.use(publicLimiter);
publicRouter.get("/", publicPersonListRules, validate, asyncHandler(c.publicList));
publicRouter.get("/:slug", publicPersonDetailRules, validate, asyncHandler(c.publicDetail));

// Administration (Admin et Super Admin) : /api/admin/people
export const adminRouter = Router();
adminRouter.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));
adminRouter.get("/", adminPersonListRules, validate, asyncHandler(c.adminList));
adminRouter.post("/", createPersonRules, validate, asyncHandler(c.create));
adminRouter.get("/:id", idParam(), validate, asyncHandler(c.adminGet));
adminRouter.patch("/:id", idParam(), updatePersonRules, validate, asyncHandler(c.update));
adminRouter.delete("/:id", idParam(), validate, asyncHandler(c.remove));
adminRouter.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));
adminRouter.post("/:id/publish", idParam(), validate, asyncHandler(c.transition("publish", "Fiche publiée")));
adminRouter.post("/:id/unpublish", idParam(), validate, asyncHandler(c.transition("unpublish", "Fiche dépubliée")));
adminRouter.post("/:id/archive", idParam(), validate, asyncHandler(c.transition("archive", "Fiche archivée")));
adminRouter.post("/:id/unarchive", idParam(), validate, asyncHandler(c.transition("unarchive", "Fiche désarchivée")));
