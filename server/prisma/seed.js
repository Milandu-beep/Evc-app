import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

// Crée le premier Super Admin (idempotent). Identifiants lus dans .env, jamais dans le code.
const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, DATABASE_URL } = process.env;

if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
  console.error("SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD sont requis dans .env");
  process.exit(1);
}
if (SEED_ADMIN_PASSWORD.length < 10) {
  console.error("SEED_ADMIN_PASSWORD doit contenir au moins 10 caractères");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

try {
  const email = SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.admin.findUnique({ where: { email } });

  if (existing) {
    console.log(`Super Admin déjà présent : ${email}`);
  } else {
    await prisma.admin.create({
      data: {
        email,
        password: await bcrypt.hash(SEED_ADMIN_PASSWORD, 12),
        firstName: "Super",
        lastName: "Admin",
        role: "SUPER_ADMIN",
      },
    });
    console.log(`Super Admin créé : ${email}`);
  }
} finally {
  await prisma.$disconnect();
}
