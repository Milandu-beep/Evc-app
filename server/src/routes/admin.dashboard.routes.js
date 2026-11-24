import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { ROLES } from "../config/constants.js";
import { activityRules, overviewRules } from "../validators/dashboard.validator.js";
import * as c from "../controllers/dashboard.controller.js";

// Tableau de bord (lecture seule) : Admin et Super Admin. Voir docs/DASHBOARD.md.
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.get("/", overviewRules, validate, asyncHandler(c.overview));
router.get("/activity", activityRules, validate, asyncHandler(c.activity));

export default router;
