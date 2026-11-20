import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import upload from "../middleware/upload.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import * as storageController from "../controllers/storage.controller.js";

const router = Router();

// Admin et Super Admin uniquement. L'authentification passe AVANT la réception du fichier.
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.post("/upload", uploadLimiter, upload.single("file"), asyncHandler(storageController.upload));
router.delete("/:id", idParam(), validate, asyncHandler(storageController.remove));

export default router;
