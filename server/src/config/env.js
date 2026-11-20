import dotenv from "dotenv";
import { isValidTimeZone } from "../utils/timezone.js";

dotenv.config();

const required = ["DATABASE_URL", "JWT_SECRET"];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
}

// Racine des fichiers chez le fournisseur : séparée par environnement pour ne jamais
// mélanger les fichiers de test et de production.
const storageRoot = process.env.STORAGE_ROOT || (process.env.NODE_ENV === "production" ? "EVC" : "EVC-dev");
if (!/^[A-Za-z0-9_-]+$/.test(storageRoot)) {
  throw new Error("STORAGE_ROOT invalide (lettres, chiffres, - et _ uniquement)");
}

// Fuseau horaire de l'église : définit où commence et finit un « jour » (fin automatique des événements).
const timeZone = process.env.APP_TIMEZONE || "Africa/Kinshasa";
if (!isValidTimeZone(timeZone)) throw new Error(`APP_TIMEZONE invalide : ${timeZone}`);

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 3000,
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : "*",
  databaseUrl: process.env.DATABASE_URL,
  storageRoot,
  timeZone,
  // Facultatif au démarrage : le module de stockage échoue proprement s'il est absent.
  cloudinary: Object.freeze({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  }),
  jwt: Object.freeze({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  }),
});

export default env;
