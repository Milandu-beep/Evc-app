import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 : l'URL de connexion n'est plus dans schema.prisma.
// DIRECT_URL (session pooler) est utilisée par la CLI (migrations).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.js" },
  datasource: { url: env("DIRECT_URL") },
});
