import AppError from "../utils/AppError.js";
import { verifyToken } from "../utils/jwt.js";
import { HTTP_STATUS } from "../config/constants.js";

// Vérifie le JWT (header Bearer ou cookie "token") et place le payload dans req.user.
export const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;

  if (!token) return next(new AppError("Authentification requise", HTTP_STATUS.UNAUTHORIZED));

  req.user = verifyToken(token); // les erreurs JWT sont traduites par errorHandler
  return next();
};

// Restreint l'accès à certains rôles : authorize(ROLES.SUPER_ADMIN)
export const authorize =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new AppError("Accès refusé", HTTP_STATUS.FORBIDDEN));
