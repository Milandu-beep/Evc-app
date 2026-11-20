import { Router } from "express";
import { param } from "express-validator";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { publicListRules, publicTodayRules } from "../validators/dailyMessage.validator.js";
import { langQuery } from "../validators/content.validator.js";
import * as controller from "../controllers/dailyMessage.controller.js";

// Lecture publique des messages du jour (sans authentification).
const router = Router();

const dateParam = param("date").isDate({ format: "YYYY-MM-DD", strictMode: true, delimiters: ["-"] }).withMessage("date : AAAA-MM-JJ valide");

router.use(publicLimiter);
router.get("/", publicListRules, validate, asyncHandler(controller.publicList));
// /today AVANT /:date
router.get("/today", publicTodayRules, validate, asyncHandler(controller.publicToday));
router.get("/:date", dateParam, langQuery, validate, asyncHandler(controller.publicByDate));

export default router;
