// Nettoyage des fichiers orphelins.
//   npm run storage:cleanup                      -> étapes 1 et 2 (base de données)
//   npm run storage:cleanup -- --dry-run         -> n'applique rien, affiche le rapport
//   npm run storage:cleanup -- --remote          -> ajoute les objets chez le fournisseur sans ligne en base
import { prismaRaw } from "../src/config/prisma.js";
import { cleanupOrphans } from "../src/services/storage/cleanup.service.js";
import logger from "../src/utils/logger.js";

const args = new Set(process.argv.slice(2));

try {
  const report = await cleanupOrphans({ dryRun: args.has("--dry-run"), remote: args.has("--remote") });
  logger.info("Nettoyage terminé", report);
  process.exitCode = report.errors > 0 ? 1 : 0;
} catch (err) {
  logger.error("Nettoyage interrompu", err.message);
  process.exitCode = 1;
} finally {
  await prismaRaw.$disconnect();
}
