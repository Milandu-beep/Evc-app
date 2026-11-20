import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import storageRoutes from "./storage.routes.js";
import { sendSuccess } from "../utils/response.js";
import { API_VERSION } from "../config/constants.js";

const router = Router();

router.get("/", (req, res) =>
  sendSuccess(res, { version: API_VERSION }, "Bienvenue sur l'API EVC")
);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/storage", storageRoutes);

// Les routes métier seront montées ici, sprint par sprint.

export default router;
