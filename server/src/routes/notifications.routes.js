import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import { cancelRules, createNotificationRules, historyRules, listNotificationRules, scheduleRules, testRules, updateNotificationRules } from "../validators/notification.validator.js";
import * as c from "../controllers/notification.controller.js";

// Public : /api/notifications/config
export const publicRouter = Router();
publicRouter.get("/config", publicLimiter, asyncHandler(c.publicConfig));

// Administration (Admin et Super Admin) : /api/admin/notifications
export const adminRouter = Router();
adminRouter.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

adminRouter.get("/", listNotificationRules, validate, asyncHandler(c.list));
adminRouter.post("/", createNotificationRules, validate, asyncHandler(c.create));
adminRouter.get("/provider", asyncHandler(c.provider)); // routes fixes avant /:id
adminRouter.post("/test", testRules, validate, asyncHandler(c.test));
adminRouter.get("/:id", idParam(), validate, asyncHandler(c.get));
adminRouter.get("/:id/history", idParam(), historyRules, validate, asyncHandler(c.history));
adminRouter.patch("/:id", idParam(), updateNotificationRules, validate, asyncHandler(c.update));
adminRouter.delete("/:id", idParam(), validate, asyncHandler(c.remove));
adminRouter.post("/:id/restore", idParam(), validate, asyncHandler(c.restore));
adminRouter.post("/:id/schedule", idParam(), scheduleRules, validate, asyncHandler(c.schedule));
adminRouter.post("/:id/send", idParam(), validate, asyncHandler(c.sendNow));
adminRouter.post("/:id/cancel", idParam(), cancelRules, validate, asyncHandler(c.cancel));
adminRouter.post("/:id/retry", idParam(), validate, asyncHandler(c.retry));
