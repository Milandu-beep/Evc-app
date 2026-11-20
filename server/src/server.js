import env from "./config/env.js";
import app from "./app.js";
import prisma from "./config/prisma.js";
import logger from "./utils/logger.js";
import { startScheduler, stopScheduler } from "./services/content/scheduler.js";

async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`; // $connect() est paresseux avec un driver adapter
    logger.info("Connexion à la base de données réussie");

    const server = app.listen(env.port, () =>
      logger.info(`EVC API démarrée sur http://localhost:${env.port} (${env.nodeEnv})`)
    );

    // Publication programmée des événements et actualités (désactivable : SCHEDULER_ENABLED=false)
    if (process.env.SCHEDULER_ENABLED !== "false") startScheduler();

    const shutdown = (signal) => {
      logger.info(`${signal} reçu, arrêt en cours...`);
      stopScheduler();
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error("Échec du démarrage", error);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => logger.error("unhandledRejection", reason));

start();
