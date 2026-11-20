import prisma from "../config/prisma.js";
import AppError from "../utils/AppError.js";
import { comparePassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { HTTP_STATUS } from "../config/constants.js";

// Hash factice : on compare toujours un mot de passe, même si l'email n'existe pas,
// pour ne pas révéler par le temps de réponse quels emails sont valides.
const DUMMY_HASH = "$2b$12$2L4ZcSpvlPridB6JR3SxZOw60FLTpeTkL9rAIcBVgevNS1xJSyaZi";

const toPublic = ({ password, ...admin }) => admin; // eslint-disable-line no-unused-vars

export async function login(email, plainPassword) {
  const admin = await prisma.admin.findUnique({ where: { email } });

  const valid = await comparePassword(plainPassword, admin?.password ?? DUMMY_HASH);
  if (!admin || !valid || !admin.isActive) {
    throw new AppError("Email ou mot de passe incorrect", HTTP_STATUS.UNAUTHORIZED);
  }

  const token = signToken({ id: admin.id, role: admin.role });
  return { token, admin: toPublic(admin) };
}

export async function getProfile(id) {
  const admin = await prisma.admin.findUnique({ where: { id } });
  if (!admin || !admin.isActive) {
    throw new AppError("Compte introuvable ou désactivé", HTTP_STATUS.UNAUTHORIZED);
  }
  return toPublic(admin);
}
