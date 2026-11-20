import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import storageRoutes from "./storage.routes.js";
import eventsRoutes from "./events.routes.js";
import adminEventsRoutes from "./admin.events.routes.js";
import newsRoutes from "./news.routes.js";
import adminNewsRoutes from "./admin.news.routes.js";
import dailyMessagesRoutes from "./dailyMessages.routes.js";
import adminDailyMessagesRoutes from "./admin.dailyMessages.routes.js";
import galleryRoutes from "./gallery.routes.js";
import adminGalleryRoutes from "./admin.gallery.routes.js";
import { adminRouter as adminPeopleRoutes, publicRouter as peopleRoutes } from "./people.routes.js";
import { adminSermons, adminSeries, publicSermons, publicSeries } from "./sermons.routes.js";
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
router.use("/daily-messages", dailyMessagesRoutes);
router.use("/admin/daily-messages", adminDailyMessagesRoutes);
router.use("/gallery", galleryRoutes);
router.use("/admin/gallery", adminGalleryRoutes);
router.use("/people", peopleRoutes);
router.use("/admin/people", adminPeopleRoutes);
router.use("/sermons", publicSermons);
router.use("/sermon-series", publicSeries);
router.use("/admin/sermons", adminSermons);
router.use("/admin/sermon-series", adminSeries);

// Les routes métier seront montées ici, sprint par sprint.

export default router;
