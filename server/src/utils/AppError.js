import { HTTP_STATUS } from "../config/constants.js";

// Erreur "attendue" (opérationnelle) : son message peut être renvoyé au client.
export default class AppError extends Error {
  constructor(message, statusCode = HTTP_STATUS.INTERNAL_ERROR, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
