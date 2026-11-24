import "./helpers/safety.mjs";
// Test d'intégration de l'authentification : API HTTP réelle + vraie base de données.
// Vérifie : le compte est relu en base à chaque requête (désactivation / suppression / rôle effet immédiat),
// l'algorithme du JWT est imposé, le cookie n'est plus accepté, l'email n'est plus « normalisé » (Gmail),
// et les règles de configuration (secret, CORS, trust proxy). Crée un administrateur temporaire, supprimé à la fin.
// Lancer : npm run test:auth
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { signToken } = await import("../src/utils/jwt.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3126);
const base = "http://localhost:3126/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 280)); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const call = async (method, path, { token, headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null };
};
const login = (email, password) => call("POST", "/auth/login", { body: { email, password } });

const password = "Test-" + randomBytes(8).toString("hex");
const email = `pr.enom+evc${tag}@gmail.com`; // points et +tag : normalizeEmail() les aurait supprimés
const admin = await prismaRaw.admin.create({ data: { email, password: await bcrypt.hash(password, 10), firstName: "Test", lastName: `Auth${tag}`, role: "ADMIN" } });
const adminRoute = "/admin/people";

try {
  await t("connexion : l'email est comparé tel quel (points et +tag d'une adresse Gmail conservés), casse ignorée", async () => {
    const a = await login(email, password);
    must(a.s === 200 && a.b.data.token && a.b.data.admin.email === email, "login exact " + a.s);
    must((await login(email.toUpperCase(), password)).s === 200, "login en majuscules");
    must((await login("  " + email + "  ", password)).s === 200, "login avec espaces");
    must((await login("prenom@gmail.com", password)).s === 401, "adresse sans les points = autre compte");
  });
  await t("connexion : mauvais mot de passe 401, email invalide 422, champs manquants 422", async () => {
    must((await login(email, "mauvais")).s === 401, "mauvais mdp");
    must((await login("pas-un-email", password)).s === 422, "email invalide");
    must((await call("POST", "/auth/login", { body: {} })).s === 422, "corps vide");
  });

  const token = (await login(email, password)).b.data.token;

  await t("jeton valide : accès aux routes d'administration et /auth/me", async () => {
    must((await call("GET", adminRoute, { token })).s === 200, "admin");
    const me = await call("GET", "/auth/me", { token });
    must(me.s === 200 && me.b.data.id === admin.id, "me");
  });
  await t("compte DÉSACTIVÉ : le jeton déjà émis est refusé tout de suite (admin et /auth/me), puis accepté à la réactivation", async () => {
    await prismaRaw.admin.update({ where: { id: admin.id }, data: { isActive: false } });
    must((await call("GET", adminRoute, { token })).s === 401, "admin désactivé");
    must((await call("GET", "/auth/me", { token })).s === 401, "me désactivé");
    must((await login(email, password)).s === 401, "login désactivé");
    await prismaRaw.admin.update({ where: { id: admin.id }, data: { isActive: true } });
    must((await call("GET", adminRoute, { token })).s === 200, "réactivé");
  });
  await t("compte SUPPRIMÉ (logiquement) : jeton refusé ; compte inconnu : jeton correctement signé refusé", async () => {
    await prismaRaw.admin.update({ where: { id: admin.id }, data: { deletedAt: new Date() } });
    must((await call("GET", adminRoute, { token })).s === 401, "supprimé");
    await prismaRaw.admin.update({ where: { id: admin.id }, data: { deletedAt: null } });
    const ghost = signToken({ id: "00000000-0000-4000-8000-000000000000", role: "SUPER_ADMIN" });
    must((await call("GET", adminRoute, { token: ghost })).s === 401, "inconnu");
  });
  await t("rôle : celui de la base fait foi (un rôle fantaisiste dans le jeton n'ouvre ni ne ferme rien)", async () => {
    const odd = signToken({ id: admin.id, role: "NIMPORTEQUOI" });
    must((await call("GET", adminRoute, { token: odd })).s === 200, "rôle du jeton ignoré");
  });
  await t("jeton falsifié : mauvaise signature, algorithme « none », autre algorithme (HS512), expiré, absent, mal formé -> 401", async () => {
    const secret = process.env.JWT_SECRET;
    const other = jwt.sign({ id: admin.id, role: "ADMIN" }, "un-autre-secret-complètement-différent");
    const none = jwt.sign({ id: admin.id, role: "ADMIN" }, "", { algorithm: "none" });
    const hs512 = jwt.sign({ id: admin.id, role: "ADMIN" }, secret, { algorithm: "HS512" });
    const expired = jwt.sign({ id: admin.id, role: "ADMIN" }, secret, { algorithm: "HS256", expiresIn: -10 });
    for (const [label, tk] of [["signature", other], ["none", none], ["HS512", hs512], ["expiré", expired], ["bidon", "abc.def.ghi"]]) {
      must((await call("GET", adminRoute, { token: tk })).s === 401, label);
    }
    must((await call("GET", adminRoute)).s === 401, "sans jeton");
    must((await call("GET", adminRoute, { headers: { authorization: token } })).s === 401, "sans « Bearer »");
  });
  await t("cookie « token » : n'est plus accepté comme moyen d'authentification", async () => {
    must((await call("GET", adminRoute, { headers: { cookie: "token=" + token } })).s === 401, "cookie");
  });

  await t("configuration : secret JWT et CORS obligatoires en production, trust proxy contrôlé", async () => {
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const run = (env) => {
      try {
        return execFileSync(process.execPath, ["--input-type=module", "-e", "const { default: e } = await import('./src/config/env.js'); console.log(JSON.stringify({ trustProxy: e.trustProxy, cors: e.corsOrigin }))"], { cwd, env: { ...process.env, ...env }, stdio: "pipe" }).toString().trim();
      } catch (e) { return String(e.stderr); }
    };
    const prod = { NODE_ENV: "production", NOTIFICATIONS_PROVIDER: "none", JWT_SECRET: "x".repeat(40), CORS_ORIGIN: "https://exemple.org" };
    must(run({ ...prod, JWT_SECRET: "court" }).includes("JWT_SECRET trop court"), "secret court en production");
    must(run({ ...prod, CORS_ORIGIN: "" }).includes("CORS_ORIGIN est obligatoire"), "CORS absent en production");
    must(JSON.parse(run(prod)).trustProxy === false, "production correcte, trust proxy désactivé par défaut");
    must(run({ NODE_ENV: "development", JWT_SECRET: "court", CORS_ORIGIN: "" }).includes('"cors":"*"'), "développement : valeurs souples acceptées");
    must(JSON.parse(run({ ...prod, TRUST_PROXY: "1" })).trustProxy === 1, "TRUST_PROXY=1");
    must(JSON.parse(run({ ...prod, TRUST_PROXY: "loopback" })).trustProxy === "loopback", "TRUST_PROXY=loopback");
    must(JSON.parse(run({ ...prod, TRUST_PROXY: "false" })).trustProxy === false, "TRUST_PROXY=false");
    must(run({ ...prod, TRUST_PROXY: "true" }).includes("TRUST_PROXY=true est refusé"), "TRUST_PROXY=true refusé");
  });
  await t("trust proxy actif : l'adresse du client (X-Forwarded-For) est celle utilisée par l'application", async () => {
    const { default: express } = await import("express");
    const probe = express();
    probe.set("trust proxy", 1);
    probe.get("/ip", (req, r) => r.json({ ip: req.ip }));
    const s = probe.listen(3127);
    const r = await fetch("http://localhost:3127/ip", { headers: { "x-forwarded-for": "203.0.113.7" } });
    await new Promise((ok) => s.close(ok));
    must((await r.json()).ip === "203.0.113.7", "ip");
  });
} finally {
  await prismaRaw.auditLog.deleteMany({ where: { adminId: admin.id } });
  await prismaRaw.admin.deleteMany({ where: { id: admin.id } });
}
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "admins", adminId: null } });
const left = await prismaRaw.admin.count({ where: { lastName: `Auth${tag}` } });
res.push(left === 0 ? "OK  nettoyage : aucun administrateur de test restant" : `KO  nettoyage : ${left} administrateurs restants`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
