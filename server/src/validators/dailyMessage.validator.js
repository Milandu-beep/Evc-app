import { body, query } from "express-validator";
import { LIFECYCLE_STATES } from "../services/content/lifecycle.js";
import {
  createTranslationRules,
  langQuery,
  pagingRules,
  scheduleRules,
  updateTranslationRules,
} from "./content.validator.js";

export { scheduleRules };

// Date au format AAAA-MM-JJ, jour de calendrier réel (le 30 février est refusé).
const dateRule = (chain, label = "date") =>
  chain.isString().isDate({ format: "YYYY-MM-DD", strictMode: true, delimiters: ["-"] }).withMessage(`${label} : date AAAA-MM-JJ valide`);

// Textes d'un message du jour (le temps de lecture n'y figure pas : il est calculé)
const TEXT_SPECS = [
  { name: "title", min: 3, max: 150, mandatory: true },
  { name: "content", min: 1, max: 10000, mandatory: true },
  { name: "verseReference", max: 100, mandatory: false, nullable: true },
  { name: "verseText", max: 1000, mandatory: false, nullable: true },
  { name: "theme", max: 60, mandatory: false, nullable: true },
  { name: "notificationTitle", max: 80, mandatory: false, nullable: true },
  { name: "notificationBody", max: 240, mandatory: false, nullable: true },
];
const NO_SLUG = { slug: false };

const fields = (required) => [
  required ? dateRule(body("date")) : dateRule(body("date").optional()),
  body("imageId").optional({ nullable: true }).isUUID().withMessage("imageId : UUID invalide"),
  body("sendNotification").optional().isBoolean({ strict: true }).withMessage("sendNotification : booléen").toBoolean(),
];

export const createDailyMessageRules = [...fields(true), ...createTranslationRules(TEXT_SPECS, NO_SLUG)];
export const updateDailyMessageRules = [...fields(false), ...updateTranslationRules(TEXT_SPECS, NO_SLUG)];

const dateRange = [
  dateRule(query("from").optional(), "from"),
  dateRule(query("to").optional(), "to"),
];
const themeQuery = query("theme").optional().isString().trim().isLength({ min: 1, max: 60 }).withMessage("theme : 60 caractères maximum");

export const adminListRules = [
  ...pagingRules,
  ...dateRange,
  themeQuery,
  query("state").optional().isIn(LIFECYCLE_STATES).withMessage(`state : ${LIFECYCLE_STATES.join(", ")}`),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["date", "createdAt", "updatedAt"]).withMessage("sort : date, createdAt ou updatedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];

export const publicListRules = [...pagingRules, ...dateRange, themeQuery, langQuery];
export const publicTodayRules = [langQuery];
export const publicDateRules = [dateRule(query("date").optional(), "date"), langQuery];
