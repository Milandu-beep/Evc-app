import rateLimit from "express-rate-limit";
import { sendError } from "../utils/response.js";
import { HTTP_STATUS } from "../config/constants.js";

// Limite les tentatives de connexion (anti force brute) : 10 par 15 minutes et par IP.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(res, "Trop de tentatives, réessayez plus tard", HTTP_STATUS.TOO_MANY_REQUESTS),
});

// Limite les envois de fichiers : 100 par 15 minutes et par IP (galerie de photos comprise).
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(res, "Trop d'envois, réessayez plus tard", HTTP_STATUS.TOO_MANY_REQUESTS),
});
