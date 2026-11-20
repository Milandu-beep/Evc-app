import { query } from "express-validator";
import { NEWS_STATES } from "../services/news/news.state.js";
import {
  commonContentFields,
  createTranslationRules,
  langQuery,
  pagingRules,
  scheduleRules,
  updateTranslationRules,
} from "./content.validator.js";

export { scheduleRules };

// Textes d'une actualité
const TEXT_SPECS = [
  { name: "title", min: 3, max: 200, mandatory: true },
  { name: "excerpt", max: 500, mandatory: false, nullable: true },
  { name: "content", min: 1, max: 50000, mandatory: true },
];

export const createNewsRules = [...commonContentFields, ...createTranslationRules(TEXT_SPECS)];
export const updateNewsRules = [...commonContentFields, ...updateTranslationRules(TEXT_SPECS)];

const dateRange = [
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
];

export const adminListRules = [
  ...pagingRules,
  ...dateRange,
  query("state").optional().isIn(NEWS_STATES).withMessage(`state : ${NEWS_STATES.join(", ")}`),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["createdAt", "updatedAt", "publishedAt"]).withMessage("sort : createdAt, updatedAt ou publishedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];

export const publicListRules = [...pagingRules, ...dateRange, langQuery];
export const publicDetailRules = [langQuery];
