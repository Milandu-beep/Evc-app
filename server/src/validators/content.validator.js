// Règles de validation communes aux contenus multilingues (événements, actualités).
import { body, query } from "express-validator";
import { LANGUAGES } from "../config/constants.js";
import { SLUG_PATTERN } from "../utils/slug.js";

export const LANGS = Object.values(LANGUAGES);

/**
 * Règles d'une langue. specs : [{ name, min?, max, mandatory, nullable? }].
 *  required : création (champs « mandatory » obligatoires) ; onlyIfPresent : la langue est facultative,
 *  mais si elle est envoyée, ses champs obligatoires le sont aussi.
 */
function translationValidators(lang, specs, { required, onlyIfPresent = false }) {
  const f = `translations.${lang}`;
  const rules = specs.map((spec) => {
    let chain = body(`${f}.${spec.name}`);
    if (spec.mandatory && required) {
      if (onlyIfPresent) chain = chain.if(body(f).exists({ checkNull: true }));
    } else {
      chain = chain.optional({ nullable: Boolean(spec.nullable) });
    }
    return chain
      .isString().withMessage(`${spec.name} : texte requis`)
      .trim().isLength({ min: spec.min ?? 0, max: spec.max })
      .withMessage(`${spec.name} : ${spec.min ? `${spec.min} à ` : ""}${spec.max} caractères${spec.min ? "" : " maximum"}`);
  });
  rules.push(
    body(`${f}.slug`)
      .optional()
      .isString().trim().isLength({ max: 100 }).matches(SLUG_PATTERN)
      .withMessage("slug : minuscules, chiffres et tirets (ex. soiree-de-louange)")
  );
  return rules;
}

const noUnknownLanguages = body("translations").custom((value) => {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("translations doit être un objet");
  const unknown = Object.keys(value).filter((k) => !LANGS.includes(k));
  if (unknown.length) throw new Error(`Langues non gérées : ${unknown.join(", ")} (autorisées : ${LANGS.join(", ")})`);
  return true;
});

// Création : français obligatoire, autres langues facultatives.
export const createTranslationRules = (specs) => [
  noUnknownLanguages,
  body("translations.fr").exists({ checkNull: true }).withMessage("La traduction française est obligatoire").isObject(),
  ...translationValidators("fr", specs, { required: true }),
  body("translations.en").optional({ nullable: true }).isObject(),
  ...translationValidators("en", specs, { required: true, onlyIfPresent: true }),
];

// Modification partielle : « translations.xx: null » supprime une langue (sauf le français, vérifié par le service).
export const updateTranslationRules = (specs) => [
  noUnknownLanguages,
  ...LANGS.flatMap((lang) => [
    body(`translations.${lang}`).optional({ nullable: true }).isObject(),
    ...translationValidators(lang, specs, { required: false }),
  ]),
];

// Champs communs : image de couverture, vedette, notification à la publication.
export const commonContentFields = [
  body("coverImageId").optional({ nullable: true }).isUUID().withMessage("coverImageId : UUID invalide"),
  body("isFeatured").optional().isBoolean({ strict: true }).withMessage("isFeatured : booléen").toBoolean(),
  body("notifyOnPublish").optional().isBoolean({ strict: true }).withMessage("notifyOnPublish : booléen").toBoolean(),
];

export const scheduleRules = [
  body("publishAt").isISO8601({ strict: true }).withMessage("publishAt : date ISO 8601 requise").toDate(),
];

// Pagination, recherche et vedette (listes d'administration et publiques).
export const pagingRules = [
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit : 1 à 100").toInt(),
  query("q").optional().isString().trim().isLength({ max: 100 }).withMessage("q : 100 caractères maximum"),
  query("featured").optional().isBoolean().withMessage("featured : booléen").toBoolean(),
];

export const langQuery = query("lang").optional().isIn(LANGS).withMessage(`lang : ${LANGS.join(", ")}`);
