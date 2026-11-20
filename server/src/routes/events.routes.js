import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { publicDetailRules, publicListRules } from "../validators/event.validator.js";
import * as eventController from "../controllers/event.controller.js";

// Lecture publique des événements (sans authentification).
const router = Router();

router.use(publicLimiter);
router.get("/", publicListRules, validate, asyncHandler(eventController.publicList));
router.get("/:slug", publicDetailRules, validate, asyncHandler(eventController.publicDetail));

export default router;
