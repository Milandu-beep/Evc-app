import { query } from "express-validator";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, DASHBOARD } from "../config/dashboard.js";
import { paginationQuery } from "./common.js";
import { langQuery } from "./content.validator.js";

// GET /admin/dashboard
export const overviewRules = [
  langQuery,
  query("days")
    .optional()
    .isInt({ min: 1, max: DASHBOARD.AGENDA_MAX_DAYS })
    .withMessage(`days : 1 à ${DASHBOARD.AGENDA_MAX_DAYS}`)
    .toInt(),
];

// GET /admin/dashboard/activity
export const activityRules = [
  ...paginationQuery,
  query("entity").optional().isIn(AUDIT_ENTITIES).withMessage(`entity : ${AUDIT_ENTITIES.join(", ")}`),
  query("action").optional().isIn(AUDIT_ACTIONS).withMessage(`action : ${AUDIT_ACTIONS.join(", ")}`),
  query("adminId").optional().isUUID().withMessage("adminId doit être un UUID valide"),
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
];
