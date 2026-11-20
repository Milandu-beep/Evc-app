import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { loginRules } from "../validators/auth.validator.js";
import * as authController from "../controllers/auth.controller.js";

const router = Router();

router.post("/login", loginLimiter, loginRules, validate, asyncHandler(authController.login));
router.get("/me", authenticate, asyncHandler(authController.me));

export default router;
