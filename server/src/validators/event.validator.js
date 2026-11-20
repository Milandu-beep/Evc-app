import { body, query } from "express-validator";
import { LANGUAGES } from "../config/constants.js";
import { SLUG_PATTERN } from "../utils/slug.js";
import { EVENT_STATES } from "../services/events/event.state.js";

const LANGS = Object.values(LANGUAGES);
const urlOptions = { protocols: ["http", "https"], require_protocol: true, require_tld: false };

// Règles d'une traduction. required : création (titre et description obligatoires).
// onlyIfPresent : la langue est facultative, mais si elle est envoyée, titre et description le sont.
const translationRules = (lang, { required, onlyIfPresent = false }) => {
  const f = `translations.${lang}`;
  const opt = (chain) => {
    if (!required) return chain.optional();
    return onlyIfPresent ? chain.if(body(f).exists({ checkNull: true })) : chain;
  };
  return [
    opt(body(`${f}.title`))
      .isString().withMessage("title : texte requis")
      .trim().isLength({ min: 3, max: 150 }).withMessage("title : 3 à 150 caractères"),
    opt(body(`${f}.description`))
      .isString().withMessage("description : texte requis")
      .trim().isLength({ min: 1, max: 10000 }).withMessage("description : 1 à 10000 caractères"),
    body(`${f}.location`).optional({ nullable: true }).isString().trim().isLength({ max: 200 }).withMessage("location : 200 caractères maximum"),
    body(`${f}.slug`)
      .optional()
      .isString().trim().isLength({ max: 100 }).matches(SLUG_PATTERN)
      .withMessage("slug : minuscules, chiffres et tirets (ex. soiree-de-louange)"),
  ];
};

// Une seule langue obligatoire à la création : le français (vérifié aussi par le service).
const noUnknownLanguages = body("translations").custom((value) => {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("translations doit être un objet");
  const unknown = Object.keys(value).filter((k) => !LANGS.includes(k));
  if (unknown.length) throw new Error(`Langues non gérées : ${unknown.join(", ")} (autorisées : ${LANGS.join(", ")})`);
  return true;
});

const commonFields = (required) => [
  required
    ? body("startsAt").isISO8601({ strict: true }).withMessage("startsAt : date ISO 8601 requise").toDate()
    : body("startsAt").optional().isISO8601({ strict: true }).withMessage("startsAt : date ISO 8601 invalide").toDate(),
  body("endsAt").optional({ nullable: true }).isISO8601({ strict: true }).withMessage("endsAt : date ISO 8601 invalide").toDate(),
  body("isFeatured").optional().isBoolean({ strict: true }).withMessage("isFeatured : booléen").toBoolean(),
  body("coverImageId").optional({ nullable: true }).isUUID().withMessage("coverImageId : UUID invalide"),
  body("registrationRequired").optional().isBoolean({ strict: true }).withMessage("registrationRequired : booléen").toBoolean(),
  body("registrationUrl")
    .optional({ nullable: true })
    .isString().trim().isURL(urlOptions).withMessage("registrationUrl : URL http(s) valide requise")
    .isLength({ max: 500 }),
  body("notifyOnPublish").optional().isBoolean({ strict: true }).withMessage("notifyOnPublish : booléen").toBoolean(),
  noUnknownLanguages,
];

export const createEventRules = [
  ...commonFields(true),
  body("translations.fr").exists({ checkNull: true }).withMessage("La traduction française est obligatoire").isObject(),
  ...translationRules("fr", { required: true }),
  body("translations.en").optional({ nullable: true }).isObject(),
  ...translationRules("en", { required: true, onlyIfPresent: true }),
];

// En modification, « translations.xx: null » supprime une langue (sauf le français).
const nullableTranslation = (lang) => [
  body(`translations.${lang}`).optional({ nullable: true }).isObject(),
  ...translationRules(lang, { required: false }),
];
export const updateEventRules = [...commonFields(false), ...LANGS.flatMap(nullableTranslation)];

export const scheduleRules = [
  body("publishAt").isISO8601({ strict: true }).withMessage("publishAt : date ISO 8601 requise").toDate(),
];
export const cancelRules = [body("reason").optional().isString().trim().isLength({ max: 500 }).withMessage("reason : 500 caractères maximum")];

const paging = [
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit : 1 à 100").toInt(),
  query("q").optional().isString().trim().isLength({ max: 100 }).withMessage("q : 100 caractères maximum"),
  query("featured").optional().isBoolean().withMessage("featured : booléen").toBoolean(),
];

export const adminListRules = [
  ...paging,
  query("state").optional().isIn(EVENT_STATES).withMessage(`state : ${EVENT_STATES.join(", ")}`),
  query("from").optional().isISO8601({ strict: true }).withMessage("from : date ISO 8601").toDate(),
  query("to").optional().isISO8601({ strict: true }).withMessage("to : date ISO 8601").toDate(),
  query("registrationRequired").optional().isBoolean().withMessage("registrationRequired : booléen").toBoolean(),
  query("deleted").optional().isBoolean().withMessage("deleted : booléen").toBoolean(),
  query("sort").optional().isIn(["startsAt", "createdAt", "updatedAt"]).withMessage("sort : startsAt, createdAt ou updatedAt"),
  query("order").optional().isIn(["asc", "desc"]).withMessage("order : asc ou desc"),
];

export const publicListRules = [
  ...paging,
  query("lang").optional().isIn(LANGS).withMessage(`lang : ${LANGS.join(", ")}`),
  query("when").optional().isIn(["upcoming", "past", "all"]).withMessage("when : upcoming, past ou all"),
];

export const publicDetailRules = [query("lang").optional().isIn(LANGS).withMessage(`lang : ${LANGS.join(", ")}`)];
