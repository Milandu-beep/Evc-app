import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import env from "./env.js";

// Prisma 7 : le client se connecte via un driver adapter.
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

const prisma = new PrismaClient({ adapter, log: ["warn", "error"] });

export default prisma;
