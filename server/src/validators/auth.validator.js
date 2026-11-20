import { body } from "express-validator";

export const loginRules = [
  body("email").isEmail().withMessage("Email invalide").normalizeEmail(),
  body("password").isString().notEmpty().withMessage("Mot de passe requis"),
];
