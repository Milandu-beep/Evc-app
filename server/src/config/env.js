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

// --- Notifications (voir docs/NOTIFICATIONS.md) ---
// Fournisseur : « onesignal » (clés requises), « fake » (développement et tests) ou « none » (désactivé : les
// notifications sont créées et planifiées mais pas envoyées). Par défaut : onesignal si les clés sont présentes, sinon none.
const oneSignalKeys = Boolean(process.env.ONESIGNAL_APP_ID && process.env.ONESIGNAL_API_KEY);
const notificationsProvider = process.env.NOTIFICATIONS_PROVIDER || (oneSignalKeys ? "onesignal" : "none");
if (!["onesignal", "fake", "none"].includes(notificationsProvider)) {
  throw new Error(`NOTIFICATIONS_PROVIDER invalide : ${notificationsProvider} (onesignal, fake ou none)`);
}
if (notificationsProvider === "onesignal" && !oneSignalKeys) {
  throw new Error("NOTIFICATIONS_PROVIDER=onesignal exige ONESIGNAL_APP_ID et ONESIGNAL_API_KEY");
}
if (notificationsProvider === "fake" && process.env.NODE_ENV === "production") {
  throw new Error("NOTIFICATIONS_PROVIDER=fake est interdit en production");
}
const dailyMessageTime = process.env.DAILY_MESSAGE_NOTIFY_TIME || "07:00";
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyMessageTime)) throw new Error("DAILY_MESSAGE_NOTIFY_TIME invalide (format HH:MM)");

// --- Sécurité (production uniquement : le développement garde ses valeurs souples) ---
if (process.env.NODE_ENV === "production") {
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET trop court en production (32 caractères minimum, ex. : openssl rand -base64 48)");
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error("CORS_ORIGIN est obligatoire en production (origines autorisées, séparées par des virgules)");
  }
}

// Proxy inverse : nombre de proxys de confiance devant l'API (ex. 1 chez un hébergeur), « loopback » ou une plage CIDR.
// Sans cela, derrière un proxy, req.ip est l'adresse du proxy (limiteurs de débit et journal d'audit faussés).
// Désactivé par défaut : une valeur trop large permettrait de falsifier l'adresse IP (X-Forwarded-For).
const trustProxyRaw = (process.env.TRUST_PROXY ?? "").trim();
if (/^(true|\*)$/i.test(trustProxyRaw)) {
  throw new Error("TRUST_PROXY=true est refusé (adresse IP falsifiable) : indiquez le nombre de proxys (ex. 1), « loopback » ou une plage CIDR");
}
const trustProxy = trustProxyRaw === "" || /^false$/i.test(trustProxyRaw) ? false : /^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw) : trustProxyRaw;

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 3000,
  trustProxy,
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
  notifications: Object.freeze({
    provider: notificationsProvider,
    publicSiteUrl: (process.env.PUBLIC_SITE_URL || "").replace(/\/+$/, ""), // préfixe des liens ouverts au toucher
    dailyMessageTime, // heure locale d'envoi de la notification du message du jour
    maxAgeHours: Number(process.env.NOTIFICATION_MAX_AGE_HOURS) || 24,
    onesignal: Object.freeze({
      appId: process.env.ONESIGNAL_APP_ID,
      apiKey: process.env.ONESIGNAL_API_KEY,
      baseUrl: process.env.ONESIGNAL_BASE_URL || "https://api.onesignal.com",
      // Segments OneSignal correspondant aux audiences (à créer dans le tableau de bord OneSignal)
      segments: Object.freeze({
        ALL: process.env.ONESIGNAL_SEGMENT_ALL || "Total Subscriptions",
        ADMINS: process.env.ONESIGNAL_SEGMENT_ADMINS || "Admins",
        MEMBERS: process.env.ONESIGNAL_SEGMENT_MEMBERS || "Members",
        VISITORS: process.env.ONESIGNAL_SEGMENT_VISITORS || "Visitors",
      }),
    }),
  }),
  jwt: Object.freeze({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  }),
});

export default env;
