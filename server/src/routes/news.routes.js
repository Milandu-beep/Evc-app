import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { publicDetailRules, publicListRules } from "../validators/news.validator.js";
import * as newsController from "../controllers/news.controller.js";

// Lecture publique des actualités (sans authentification).
const router = Router();

router.use(publicLimiter);
router.get("/", publicListRules, validate, asyncHandler(newsController.publicList));
router.get("/:slug", publicDetailRules, validate, asyncHandler(newsController.publicDetail));

export default router;
