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

// Lecture publique : 1000 requêtes par 15 minutes et par IP (plusieurs visiteurs peuvent partager une IP).
export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(res, "Trop de requêtes, réessayez plus tard", HTTP_STATUS.TOO_MANY_REQUESTS),
});
