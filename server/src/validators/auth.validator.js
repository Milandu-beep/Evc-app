import { body } from "express-validator";

// L'email est comparé tel quel (espaces retirés, minuscules) : normalizeEmail() est volontairement évité,
// car il supprime les points et le « +tag » des adresses Gmail et ne correspondrait plus à l'email enregistré
// (le seed, lui, ne fait que mettre en minuscules).
export const loginRules = [
  body("email").isString().trim().isEmail().withMessage("Email invalide").bail().toLowerCase(),
  body("password").isString().notEmpty().withMessage("Mot de passe requis"),
];
