import { param, query } from "express-validator";

// Règles réutilisables par les futurs validators métier.
export const idParam = (name = "id") =>
  param(name).isInt({ min: 1 }).withMessage(`${name} doit être un entier positif`).toInt();

export const paginationQuery = [
  query("page").optional().isInt({ min: 1 }).withMessage("page invalide").toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit invalide").toInt(),
];
