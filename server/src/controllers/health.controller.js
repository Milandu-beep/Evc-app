import prisma from "../config/prisma.js";
import { sendSuccess } from "../utils/response.js";
import { API_VERSION } from "../config/constants.js";

// Contrôleur technique (non métier) : état du serveur et de la base.
export const check = async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  sendSuccess(
    res,
    { status: "ok", database: "up", uptime: process.uptime(), version: API_VERSION },
    "API opérationnelle"
  );
};
