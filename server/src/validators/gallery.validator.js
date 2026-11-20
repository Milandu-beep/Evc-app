import { body, query } from "express-validator";
import { ALBUM_STATES, ITEMS_PAGE_MAX, MAX_TAGS } from "../services/gallery/gallery.common.js";
import { createTranslationRules, langQuery, pagingRules, updateTranslationRules } from "./content.validator.js";

const dateRule = (chain, label) => chain.isString().isDate({ format: "YYYY-MM-DD", strictMode: true, delimiters: ["-"] }).withMessage(`${label} : date AAAA-MM-JJ valide`);
const uuidList = (field, max) => [
  body(field).isArray({ min: 1, max }).withMessage(`${field} : tableau de 1 à ${max} identifiants`),
  body(`${field}.*`).isUUID().withMessage(`${field} : UUID invalide`),
];
// Tags saisis : texte de 60 caractères au plus (ils sont ensuite normalisés), 40 au plus par requête
const tagList = (field = "tags") => [
  body(field).optional().isArray({ max: MAX_TAGS * 2 }).withMessage(`${field} : tableau de ${MAX_TAGS * 2} tags au plus`),
  body(`${field}.*`).isString().trim().isLength({ min: 1, max: 60 }).withMessage("tag : texte de 1 à 60 caractères"),
];

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------
const ALBUM_TEXTS = [
  { name: "title", min: 3, max: 150, mandatory: true },
  { name: "description", max: 2000, mandatory: false, nullable: true },
];
const albumFields = (create) => [
  dateRule(body("date").optional(), "date"),
  body("isFeatured").optional().isBoolean({ strict: true }).withMessage("isFeatured : booléen").toBoolean(),
  body("sortOrder").optional().isInt({ min: 0, max: 100000 }).withMessage("sortOrder : entier de 0 à 100000").toInt(),
  body("coverImageId").optional({ nullable: true }).isUUID().withMessage("coverImageId : UUID invalide"),
  body("linkedEventId").optional({ nullable: true }).isUUID().withMessage("linkedEventId : UUID invalide"),
  ...(create ? [] : []),
];
export const createAlbumRules = [...albumFields(true), ...createTranslationRules(ALBUM_TEXTS)];
export const updateAlbumRules = [...albumFields(false), ...updateTranslationRules(ALBUM_TEXTS)];

export const adminAlbumListRules = [
  ...pagingRules,
  dateRule(query("from").optional(), "from"),
  dateRule(query("to").optional(), "to"),
  query("status").optional().isIn(ALBUM_STATES).withMessage(`status : ${ALBUM_STATES.join(", ")}`),
  query("eventId").optional().isUUID().withMessage("eventId : UUID invalide"),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["date", "createdAt", "updatedAt", "sortOrder"]).withMessage("sort : date, createdAt, updatedAt ou sortOrder"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];

export const reorderAlbumsRules = uuidList("ids", 1000);

// ---------------------------------------------------------------------------
// Médias
// ---------------------------------------------------------------------------
// Tous les textes d'un média sont facultatifs et effaçables (null) ; aucune langue n'est obligatoire.
const ITEM_TEXTS = [
  { name: "title", max: 150, mandatory: false, nullable: true },
  { name: "description", max: 2000, mandatory: false, nullable: true },
  { name: "altText", max: 250, mandatory: false, nullable: true },
];
export const updateItemRules = [...tagList("tags"), ...updateTranslationRules(ITEM_TEXTS, { slug: false })];
export const attachItemsRules = [...uuidList("storageFileIds", 50), ...tagList("tags")];
export const reorderItemsRules = uuidList("itemIds", 2000);
export const moveItemsRules = [...uuidList("itemIds", 200), body("toAlbumId").isUUID().withMessage("toAlbumId : UUID invalide")];

export const itemListRules = [
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: ITEMS_PAGE_MAX }).withMessage(`limit : 1 à ${ITEMS_PAGE_MAX}`).toInt(),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
];

// ---------------------------------------------------------------------------
// Lecture publique
// ---------------------------------------------------------------------------
const tagFilter = [
  query("tags").optional().isString().isLength({ max: 400 }).withMessage("tags : liste séparée par des virgules (400 caractères au plus)"),
  query("match").optional().isIn(["all", "any"]).withMessage("match : all (tous les tags) ou any (au moins un)"),
];
const typeQuery = query("type").optional().isIn(["PHOTO", "VIDEO"]).withMessage("type : PHOTO ou VIDEO");
const dates = [dateRule(query("from").optional(), "from"), dateRule(query("to").optional(), "to")];

export const publicAlbumListRules = [
  ...pagingRules,
  ...tagFilter,
  ...dates,
  langQuery,
  query("eventId").optional().isUUID().withMessage("eventId : UUID invalide"),
  query("sort").optional().isIn(["recent", "manual"]).withMessage("sort : recent ou manual"),
];
export const publicAlbumDetailRules = [
  langQuery,
  ...tagFilter,
  typeQuery,
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: ITEMS_PAGE_MAX }).withMessage(`limit : 1 à ${ITEMS_PAGE_MAX}`).toInt(),
];
export const publicItemListRules = [
  ...pagingRules,
  ...tagFilter,
  typeQuery,
  langQuery,
  query("albumId").optional().isUUID().withMessage("albumId : UUID invalide"),
  query("eventId").optional().isUUID().withMessage("eventId : UUID invalide"),
];
export const publicHomeRules = [langQuery, query("limit").optional().isInt({ min: 1, max: 24 }).withMessage("limit : 1 à 24").toInt()];
