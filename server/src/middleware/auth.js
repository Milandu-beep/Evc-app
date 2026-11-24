import prisma from "../config/prisma.js";
import AppError from "../utils/AppError.js";
import { verifyToken } from "../utils/jwt.js";
import { HTTP_STATUS } from "../config/constants.js";

// Vérifie le JWT (en-tête Bearer) puis RELIT l'administrateur en base : un compte désactivé, supprimé
// ou rétrogradé perd son accès immédiatement, sans attendre l'expiration du token. Le rôle utilisé est
// celui de la base, jamais celui inscrit dans le token. Place { id, role } dans req.user.
// Les routes d'administration sont peu sollicitées : une requête par appel est négligeable.
export const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return next(new AppError("Authentification requise", HTTP_STATUS.UNAUTHORIZED));

  const payload = verifyToken(token); // les erreurs JWT sont traduites par errorHandler
  const admin = await prisma.admin.findUnique({ where: { id: payload.id }, select: { id: true, role: true, isActive: true } });
  if (!admin || !admin.isActive) {
    return next(new AppError("Compte introuvable ou désactivé", HTTP_STATUS.UNAUTHORIZED));
  }

  req.user = { id: admin.id, role: admin.role };
  return next();
};

// Restreint l'accès à certains rôles : authorize(ROLES.SUPER_ADMIN)
export const authorize =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new AppError("Accès refusé", HTTP_STATUS.FORBIDDEN));
