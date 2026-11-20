import { body, query } from "express-validator";
import { LIFECYCLE_STATES } from "../services/content/lifecycle.js";
import { PUBLISH_STATES } from "../services/content/simpleLifecycle.js";
import { MAX_DOCUMENTS, MAX_SPEAKERS, MAX_VERSES, SPEAKER_ROLES } from "../services/sermons/sermon.common.js";
import { LANGS, createTranslationRules, langQuery, noUnknownLanguages, pagingRules, scheduleRules, updateTranslationRules } from "./content.validator.js";

export { scheduleRules };

const dateRule = (chain, label) => chain.isString().isDate({ format: "YYYY-MM-DD", strictMode: true, delimiters: ["-"] }).withMessage(`${label} : date AAAA-MM-JJ valide`);
const uuidList = (field, max) => [
  body(field).isArray({ min: 1, max }).withMessage(`${field} : tableau de 1 à ${max} identifiants`),
  body(`${field}.*`).isUUID().withMessage(`${field} : UUID invalide`),
];

// ---------------------------------------------------------------------------
// Prédications
// ---------------------------------------------------------------------------
const SERMON_TEXTS = [
  { name: "title", min: 3, max: 150, mandatory: true },
  { name: "description", max: 3000, mandatory: false, nullable: true },
  { name: "theme", max: 60, mandatory: false, nullable: true },
];
// Références de versets (tableau) : 10 au plus, 80 caractères chacune
const verseRules = LANGS.flatMap((lang) => [
  body(`translations.${lang}.verseReferences`).optional({ nullable: true }).isArray({ max: MAX_VERSES }).withMessage(`verseReferences : ${MAX_VERSES} références au plus`),
  // Les lignes vides sont acceptées (formulaires) : le service les retire
  body(`translations.${lang}.verseReferences.*`).isString().trim().isLength({ max: 80 }).withMessage("verseReferences : références de 80 caractères au plus"),
]);

const sermonFields = (create) => [
  create ? dateRule(body("date"), "date") : dateRule(body("date").optional(), "date"),
  body("seriesId").optional({ nullable: true }).isUUID().withMessage("seriesId : UUID invalide"),
  body("seriesPosition").optional({ nullable: true }).isInt({ min: 1, max: 1000 }).withMessage("seriesPosition : entier de 1 à 1000").toInt(),
  body("coverImageId").optional({ nullable: true }).isUUID().withMessage("coverImageId : UUID invalide"),
  body("audioFileId").optional({ nullable: true }).isUUID().withMessage("audioFileId : UUID invalide"),
  body("videoFileId").optional({ nullable: true }).isUUID().withMessage("videoFileId : UUID invalide"),
  body("youtubeUrl").optional({ nullable: true }).isString().trim().isLength({ min: 11, max: 300 }).withMessage("youtubeUrl : lien YouTube de 300 caractères au plus"),
  body("isFeatured").optional().isBoolean({ strict: true }).withMessage("isFeatured : booléen").toBoolean(),
  body("notifyOnPublish").optional().isBoolean({ strict: true }).withMessage("notifyOnPublish : booléen").toBoolean(),
  body("tags").optional().isArray({ max: 40 }).withMessage("tags : tableau de 40 tags au plus"),
  body("tags.*").isString().trim().isLength({ min: 1, max: 60 }).withMessage("tag : texte de 1 à 60 caractères"),
  // Intervenants : « speakers » (plusieurs, avec rôle) ou « preacherId » (raccourci : un seul prédicateur)
  body("preacherId").optional({ nullable: true }).isUUID().withMessage("preacherId : UUID invalide"),
  body("speakers").optional().isArray({ max: MAX_SPEAKERS }).withMessage(`speakers : ${MAX_SPEAKERS} intervenants au plus`),
  body("speakers.*.personId").isUUID().withMessage("speakers : personId UUID requis"),
  body("speakers.*.role").optional().isIn(SPEAKER_ROLES).withMessage(`speakers : role ${SPEAKER_ROLES.join(", ")}`),
];
export const createSermonRules = [...sermonFields(true), ...createTranslationRules(SERMON_TEXTS), ...verseRules];
export const updateSermonRules = [...sermonFields(false), ...updateTranslationRules(SERMON_TEXTS), ...verseRules];

const filters = [
  query("tags").optional().isString().isLength({ max: 400 }).withMessage("tags : liste séparée par des virgules (400 caractères au plus)"),
  query("match").optional().isIn(["all", "any"]).withMessage("match : all ou any"),
  query("theme").optional().isString().trim().isLength({ min: 1, max: 60 }).withMessage("theme : 60 caractères au plus"),
  query("verse").optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage("verse : 80 caractères au plus"),
  query("seriesId").optional().isUUID().withMessage("seriesId : UUID invalide"),
  query("speakerId").optional().isUUID().withMessage("speakerId : UUID invalide"),
  query("role").optional().isIn(SPEAKER_ROLES).withMessage(`role : ${SPEAKER_ROLES.join(", ")}`),
  query("hasAudio").optional().isBoolean().withMessage("hasAudio : booléen").toBoolean(),
  query("hasVideo").optional().isBoolean().withMessage("hasVideo : booléen").toBoolean(),
  dateRule(query("from").optional(), "from"),
  dateRule(query("to").optional(), "to"),
];

export const adminSermonListRules = [
  ...pagingRules,
  ...filters,
  query("state").optional().isIn(LIFECYCLE_STATES).withMessage(`state : ${LIFECYCLE_STATES.join(", ")}`),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["date", "createdAt", "updatedAt", "playCount", "viewCount", "downloadCount"]).withMessage("sort : date, createdAt, updatedAt, playCount, viewCount ou downloadCount"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];
export const publicSermonListRules = [
  ...pagingRules,
  ...filters,
  langQuery,
  query("series").optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage("series : slug de série"),
  query("sort").optional().isIn(["recent", "oldest", "popular"]).withMessage("sort : recent, oldest ou popular"),
];
export const publicSermonDetailRules = [langQuery];

// ---------------------------------------------------------------------------
// Documents PDF
// ---------------------------------------------------------------------------
const docTitle = (lang) => body(`documents.*.translations.${lang}.title`).optional().isString().trim().isLength({ min: 1, max: 150 }).withMessage("title : 1 à 150 caractères");
export const addDocumentsRules = [
  body("documents").isArray({ min: 1, max: MAX_DOCUMENTS }).withMessage(`documents : tableau de 1 à ${MAX_DOCUMENTS} documents`),
  body("documents.*.storageFileId").isUUID().withMessage("storageFileId : UUID invalide"),
  ...LANGS.map(docTitle),
];
// noUnknownLanguages : expose l'objet « translations » tel quel à matchedData, pour que « en: null » (retirer une langue) soit pris en compte
export const updateDocumentRules = [
  noUnknownLanguages,
  ...LANGS.flatMap((lang) => [
    body(`translations.${lang}`).optional({ nullable: true }).isObject(),
    body(`translations.${lang}.title`).optional().isString().trim().isLength({ min: 1, max: 150 }).withMessage("title : 1 à 150 caractères"),
  ]),
];
export const reorderDocumentsRules = uuidList("documentIds", 200);

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------
const SERIES_TEXTS = [
  { name: "title", min: 3, max: 150, mandatory: true },
  { name: "description", max: 2000, mandatory: false, nullable: true },
];
const seriesFields = [
  body("sortOrder").optional().isInt({ min: 0, max: 100000 }).withMessage("sortOrder : entier de 0 à 100000").toInt(),
  body("isFeatured").optional().isBoolean({ strict: true }).withMessage("isFeatured : booléen").toBoolean(),
  body("coverImageId").optional({ nullable: true }).isUUID().withMessage("coverImageId : UUID invalide"),
];
export const createSeriesRules = [...seriesFields, ...createTranslationRules(SERIES_TEXTS)];
export const updateSeriesRules = [...seriesFields, ...updateTranslationRules(SERIES_TEXTS)];
export const adminSeriesListRules = [
  ...pagingRules,
  query("status").optional().isIn(PUBLISH_STATES).withMessage(`status : ${PUBLISH_STATES.join(", ")}`),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["sortOrder", "createdAt", "updatedAt"]).withMessage("sort : sortOrder, createdAt ou updatedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];
export const publicSeriesListRules = [...pagingRules, langQuery];
export const publicSeriesDetailRules = [
  langQuery,
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit : 1 à 100").toInt(),
];
