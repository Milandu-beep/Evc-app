import env from "../config/env.js";
import logger from "../utils/logger.js";
import { sendError } from "../utils/response.js";
import { HTTP_STATUS } from "../config/constants.js";

// Doit garder 4 arguments pour qu'Express le reconnaisse comme gestionnaire d'erreurs.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || err.status || HTTP_STATUS.INTERNAL_ERROR;
  let message = err.message;
  const details = err.details || null;

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    status = HTTP_STATUS.UNAUTHORIZED;
    message = "Token invalide ou expiré";
  } else if (err.name === "MulterError") {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : HTTP_STATUS.BAD_REQUEST;
    message = err.code === "LIMIT_FILE_SIZE" ? "Fichier trop volumineux" : "Envoi de fichier invalide";
  } else if (err.type === "entity.parse.failed") {
    status = HTTP_STATUS.BAD_REQUEST;
    message = "JSON invalide";
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${err.message}`, err.stack);
    if (env.isProduction && !err.isOperational) message = "Erreur interne du serveur";
  }

  return sendError(res, message, status, details);
};

export default errorHandler;
