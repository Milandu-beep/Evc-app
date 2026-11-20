import { validationResult } from "express-validator";
import AppError from "../utils/AppError.js";
import { HTTP_STATUS } from "../config/constants.js";

// À placer après une chaîne de règles express-validator.
const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array().map((e) => ({ field: e.path, message: e.msg }));
  return next(new AppError("Données invalides", HTTP_STATUS.UNPROCESSABLE, errors));
};

export default validate;
