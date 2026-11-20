import AppError from "../utils/AppError.js";
import { HTTP_STATUS } from "../config/constants.js";

const notFound = (req, res, next) =>
  next(new AppError(`Route introuvable : ${req.method} ${req.originalUrl}`, HTTP_STATUS.NOT_FOUND));

export default notFound;
