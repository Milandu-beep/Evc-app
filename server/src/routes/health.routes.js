import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { check } from "../controllers/health.controller.js";

const router = Router();

router.get("/", asyncHandler(check));

export default router;
