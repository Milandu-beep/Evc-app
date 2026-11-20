import { body, query } from "express-validator";
import { PUBLISH_STATES } from "../services/content/simpleLifecycle.js";
import { SLUG_PATTERN } from "../utils/slug.js";
import { langQuery, pagingRules, updateTranslationRules } from "./content.validator.js";

export const PERSON_CATEGORIES = ["PASTOR", "TEAM", "SPEAKER", "LEADER", "OTHER"];

// Titre (« Pasteur principal ») et biographie : facultatifs, effaçables, aucune langue obligatoire
const TEXTS = [
  { name: "title", max: 120, mandatory: false, nullable: true },
  { name: "bio", max: 5000, mandatory: false, nullable: true },
];

const nameField = (field, required) => {
  const chain = required ? body(field) : body(field).optional();
  return chain.isString().trim().isLength({ min: 1, max: 80 }).withMessage(`${field} : 1 à 80 caractères`);
};
const fields = (create) => [
  nameField("firstName", create),
  nameField("lastName", create),
  body("slug").optional().isString().trim().isLength({ max: 100 }).matches(SLUG_PATTERN).withMessage("slug : minuscules, chiffres et tirets"),
  body("categories").optional().isArray({ max: PERSON_CATEGORIES.length }).withMessage("categories : tableau"),
  body("categories.*").isIn(PERSON_CATEGORIES).withMessage(`categories : ${PERSON_CATEGORIES.join(", ")}`),
  body("sortOrder").optional().isInt({ min: 0, max: 100000 }).withMessage("sortOrder : entier de 0 à 100000").toInt(),
  body("photoId").optional({ nullable: true }).isUUID().withMessage("photoId : UUID invalide"),
];
export const createPersonRules = [...fields(true), ...updateTranslationRules(TEXTS, { slug: false })];
export const updatePersonRules = [...fields(false), ...updateTranslationRules(TEXTS, { slug: false })];

const categoryQuery = query("category").optional().isIn(PERSON_CATEGORIES).withMessage(`category : ${PERSON_CATEGORIES.join(", ")}`);

export const adminPersonListRules = [
  ...pagingRules,
  categoryQuery,
  query("status").optional().isIn(PUBLISH_STATES).withMessage(`status : ${PUBLISH_STATES.join(", ")}`),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["sortOrder", "lastName", "createdAt", "updatedAt"]).withMessage("sort : sortOrder, lastName, createdAt ou updatedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];
export const publicPersonListRules = [...pagingRules, categoryQuery, langQuery];
export const publicPersonDetailRules = [langQuery];
