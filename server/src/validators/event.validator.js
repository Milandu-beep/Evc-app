import { body, query } from "express-validator";
import { EVENT_TYPES } from "../config/constants.js";
import { EVENT_STATES } from "../services/events/event.state.js";
import {
  LANGS,
  commonContentFields,
  createTranslationRules,
  langQuery,
  pagingRules,
  scheduleRules,
  updateTranslationRules,
} from "./content.validator.js";

export { scheduleRules };

const urlOptions = { protocols: ["http", "https"], require_protocol: true, require_tld: false };

// Textes d'un événement
const TEXT_SPECS = [
  { name: "title", min: 3, max: 150, mandatory: true },
  { name: "description", min: 1, max: 10000, mandatory: true },
  { name: "location", max: 200, mandatory: false, nullable: true },
];

const eventFields = (required) => [
  required
    ? body("startsAt").isISO8601({ strict: true }).withMessage("startsAt : date ISO 8601 requise").toDate()
    : body("startsAt").optional().isISO8601({ strict: true }).withMessage("startsAt : date ISO 8601 invalide").toDate(),
  body("endsAt").optional({ nullable: true }).isISO8601({ strict: true }).withMessage("endsAt : date ISO 8601 invalide").toDate(),
  body("type").optional().isIn(EVENT_TYPES).withMessage(`type : ${EVENT_TYPES.join(", ")}`),
  body("capacity").optional({ nullable: true }).isInt({ min: 1, max: 1000000 }).withMessage("capacity : entier de 1 à 1 000 000 (null = illimitée)").toInt(),
  body("color")
    .optional({ nullable: true })
    .isString().matches(/^#[0-9a-fA-F]{6}$/).withMessage("color : couleur hexadécimale #RRGGBB")
    .customSanitizer((v) => v.toLowerCase()),
  body("icon")
    .optional({ nullable: true })
    .isString().isLength({ max: 40 }).matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .withMessage("icon : nom d'icône en minuscules et tirets (ex. church, music-note)"),
  body("registrationRequired").optional().isBoolean({ strict: true }).withMessage("registrationRequired : booléen").toBoolean(),
  body("registrationUrl")
    .optional({ nullable: true })
    .isString().trim().isURL(urlOptions).withMessage("registrationUrl : URL http(s) valide requise")
    .isLength({ max: 500 }),
  ...commonContentFields,
];

export const createEventRules = [...eventFields(true), ...createTranslationRules(TEXT_SPECS)];
export const updateEventRules = [...eventFields(false), ...updateTranslationRules(TEXT_SPECS)];

export const cancelRules = [body("reason").optional().isString().trim().isLength({ max: 500 }).withMessage("reason : 500 caractères maximum")];

const typeQuery = query("type").optional().isIn(EVENT_TYPES).withMessage(`type : ${EVENT_TYPES.join(", ")}`);

export const adminListRules = [
  ...pagingRules,
  typeQuery,
  query("state").optional().isIn(EVENT_STATES).withMessage(`state : ${EVENT_STATES.join(", ")}`),
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
  query("registrationRequired").optional().isBoolean().withMessage("registrationRequired : booléen").toBoolean(),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["startsAt", "createdAt", "updatedAt"]).withMessage("sort : startsAt, createdAt ou updatedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];

export const publicListRules = [
  ...pagingRules,
  typeQuery,
  langQuery,
  query("when").optional().isIn(["upcoming", "past", "all"]).withMessage("when : upcoming, past ou all"),
];

export const publicDetailRules = [langQuery];

// Calendrier : soit un mois (?month=2026-12), soit une plage (?from=…&to=…), pas les deux.
const MAX_RANGE_DAYS = 366;
export const calendarRules = [
  langQuery,
  typeQuery,
  query("month").optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage("month : format AAAA-MM"),
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
  query("month").custom((month, { req }) => {
    const { from, to } = req.query;
    if (month && (from || to)) throw new Error("Utilisez soit month, soit from et to");
    if (!month && !(from && to)) throw new Error("Précisez month (AAAA-MM) ou from et to");
    return true;
  }),
  query("to").custom((to, { req }) => {
    const { from } = req.query;
    if (!from || !to) return true;
    const start = new Date(from);
    const end = new Date(to);
    if (!(end > start)) throw new Error("to doit être postérieur à from");
    if ((end - start) / 86400000 > MAX_RANGE_DAYS) throw new Error(`Plage limitée à ${MAX_RANGE_DAYS} jours`);
    return true;
  }),
];

export { LANGS };
