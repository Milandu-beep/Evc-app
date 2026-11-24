import { body, query } from "express-validator";
import { NOTIFICATION } from "../config/notifications.js";
import { LANGS, createTranslationRules, pagingRules, updateTranslationRules } from "./content.validator.js";

const STATUSES = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"];
const TYPES = ["GENERAL", "EVENT", "NEWS", "DAILY_MESSAGE", "SERMON", "TEST"];

// Textes par langue : en-tête (80), message (240), lien d'ouverture facultatif
const TEXTS = [
  { name: "title", min: 1, max: NOTIFICATION.TITLE_MAX, mandatory: true },
  { name: "message", min: 1, max: NOTIFICATION.MESSAGE_MAX, mandatory: true },
  { name: "url", max: NOTIFICATION.URL_MAX, mandatory: false, nullable: true },
];

// Lien : chemin de l'application (« /events/soiree ») ou adresse http(s) complète
const target = (value) => {
  if (value == null) return true;
  if (/^\/(?!\/)\S*$/.test(value) || /^https?:\/\/\S+$/i.test(value)) return true;
  throw new Error("url : chemin commençant par / (ex. /events/soiree) ou adresse http(s)");
};
const urlRules = LANGS.map((lang) => body(`translations.${lang}.url`).optional({ nullable: true }).custom(target));

const audience = body("audience").optional().isIn(NOTIFICATION.AUDIENCES).withMessage(`audience : ${NOTIFICATION.AUDIENCES.join(", ")}`);
const links = ["eventId", "newsId", "dailyMessageId", "sermonId"].map((f) => body(f).optional().isUUID().withMessage(`${f} : UUID invalide`));

export const createNotificationRules = [
  audience,
  body("scheduledAt").optional().isISO8601({ strict: true }).withMessage("scheduledAt : date ISO 8601").toDate(),
  ...links,
  ...createTranslationRules(TEXTS, { slug: false }),
  ...urlRules,
];
export const updateNotificationRules = [audience, ...updateTranslationRules(TEXTS, { slug: false }), ...urlRules];

export const scheduleRules = [body("scheduledAt").isISO8601({ strict: true }).withMessage("scheduledAt : date ISO 8601 requise").toDate()];
export const cancelRules = [body("reason").optional().isString().trim().isLength({ max: 300 }).withMessage("reason : 300 caractères maximum")];
export const testRules = [
  body("language").optional().isIn(LANGS).withMessage(`language : ${LANGS.join(", ")}`),
  body("title").optional().isString().trim().isLength({ min: 1, max: NOTIFICATION.TITLE_MAX }).withMessage(`title : 1 à ${NOTIFICATION.TITLE_MAX} caractères`),
  body("message").optional().isString().trim().isLength({ min: 1, max: NOTIFICATION.MESSAGE_MAX }).withMessage(`message : 1 à ${NOTIFICATION.MESSAGE_MAX} caractères`),
];

export const listNotificationRules = [
  ...pagingRules,
  query("status").optional().isIn(STATUSES).withMessage(`status : ${STATUSES.join(", ")}`),
  query("type").optional().isIn(TYPES).withMessage(`type : ${TYPES.join(", ")}`),
  query("audience").optional().isIn(NOTIFICATION.AUDIENCES).withMessage(`audience : ${NOTIFICATION.AUDIENCES.join(", ")}`),
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["createdAt", "scheduledAt", "sentAt"]).withMessage("sort : createdAt, scheduledAt ou sentAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];
export const historyRules = [
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: 200 }).withMessage("limit : 1 à 200").toInt(),
];
