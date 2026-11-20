import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { calendarRules, publicDetailRules, publicListRules } from "../validators/event.validator.js";
import * as eventController from "../controllers/event.controller.js";

// Lecture publique des événements (sans authentification).
const router = Router();

router.use(publicLimiter);
router.get("/", publicListRules, validate, asyncHandler(eventController.publicList));
// /calendar AVANT /:slug : « calendar » est un identifiant réservé
router.get("/calendar", calendarRules, validate, asyncHandler(eventController.publicCalendar));
router.get("/:slug", publicDetailRules, validate, asyncHandler(eventController.publicDetail));

export default router;
