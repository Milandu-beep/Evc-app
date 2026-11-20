import prisma from "../config/prisma.js";
import logger from "../utils/logger.js";

// Champs qui ne doivent jamais apparaître dans le journal.
const SENSITIVE = new Set(["password", "token"]);

const clean = (changes) =>
  changes && Object.fromEntries(Object.entries(changes).filter(([k]) => !SENSITIVE.has(k)));

// Enregistre une action. Ne fait jamais échouer l'opération principale :
// une erreur d'audit est loggée, pas propagée.
// req (facultatif) fournit l'IP et le user-agent ; admin = req.user ou { id }.
export async function record({ action, entity, entityId = null, adminId = null, changes = null, req = null }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId ? String(entityId) : null,
        adminId: adminId ?? req?.user?.id ?? null,
        changes: clean(changes) ?? undefined,
        ipAddress: req?.ip ?? null,
        userAgent: req?.headers?.["user-agent"]?.slice(0, 255) ?? null,
      },
    });
  } catch (err) {
    logger.error(`Audit non enregistré (${action} ${entity})`, err.message);
  }
}
