import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import storageRoutes from "./storage.routes.js";
import eventsRoutes from "./events.routes.js";
import adminEventsRoutes from "./admin.events.routes.js";
import newsRoutes from "./news.routes.js";
import adminNewsRoutes from "./admin.news.routes.js";
import { sendSuccess } from "../utils/response.js";
import { API_VERSION } from "../config/constants.js";

const router = Router();

router.get("/", (req, res) =>
  sendSuccess(res, { version: API_VERSION }, "Bienvenue sur l'API EVC")
);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/storage", storageRoutes);
router.use("/events", eventsRoutes);
router.use("/admin/events", adminEventsRoutes);
router.use("/news", newsRoutes);
router.use("/admin/news", adminNewsRoutes);

// Les routes métier seront montées ici, sprint par sprint.

export default router;
