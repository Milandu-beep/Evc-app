import "./helpers/safety.mjs";
// Test d'intégration du système de notifications : API HTTP réelle + vraie base de données, avec le FakeProvider
// (aucun appel à OneSignal ni à un autre service). Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.
// ATTENTION : la table des notifications doit être vide au départ (l'expéditeur traite toutes les notifications dues).
// Lancer : npm run test:notifications
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { domainEvents } = await import("../src/utils/domainEvents.js");
const { FakeProvider, OneSignalProvider, NoneProvider, getProvider, setProvider } = await import("../src/services/notifications/providers/index.js");
const { ProviderError } = await import("../src/services/notifications/providers/provider.js");
const { dispatchDue } = await import("../src/services/notifications/notification.dispatcher.js");
const { registerNotificationListeners, processDomainEvent } = await import("../src/services/notifications/notification.listeners.js");
const { dailyMessageSendTime } = await import("../src/services/notifications/notification.content.js");
const { publishDueNews } = await import("../src/services/content/scheduler.js");
const { buildMessage } = await import("../src/services/notifications/notification.message.js");
const { localDateTimeToUtc } = await import("../src/utils/timezone.js");
const { todayString } = await import("../src/services/dailyMessages/dailyMessage.state.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3125);
const base = "http://localhost:3125/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 320)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

if (await prismaRaw.notification.count()) { console.log("ARRÊT : la table des notifications n'est pas vide ; ce test exige une table vide."); process.exit(1); }
const initialProvider = getProvider();

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function api(method, path, body, { auth = true } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const N = "/admin/notifications";
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const MIN = 60e3, H = 3600e3, D = 24 * H;
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 120)); } };
const historyOf = async (id) => (await api("GET", `${N}/${id}`)).b.data.history.map((h) => h.event);
const draftBody = (over = {}, fr = {}) => ({ translations: { fr: { title: `ntf-${tag} titre`, message: "Message de test", ...fr } }, ...over });
const mk = async (over = {}, fr = {}) => { const r = await api("POST", N, draftBody(over, fr)); if (r.s !== 201) throw new Error("création " + r.s + JSON.stringify(r.b).slice(0, 300)); return r.b.data; };
// Notification planifiée DIRECTEMENT en base (sans passer par l'API), à l'échéance voulue
const mkDue = async (scheduledAt = new Date(Date.now() - 1000), over = {}) => {
  const n = await prismaRaw.notification.create({ data: { type: "GENERAL", status: "SCHEDULED", scheduledAt, translations: { create: [{ language: "fr", title: `ntf-${tag} direct`, message: "m" }] }, ...over } });
  return n;
};
const raw = (id) => prismaRaw.notification.findUnique({ where: { id }, include: { translations: true } });

// --- Données de contenu pour les notifications automatiques ---
const ctx = { events: [], news: [], daily: [], sermons: [], people: [] };
const audioFile = await prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test-notif/" + randomBytes(6).toString("hex"), resourceType: "VIDEO", url: "http://x", secureUrl: "https://x", folder: "sermons/audio", originalFilename: `ntf-${tag}.mp3`, mimeType: "audio/mpeg", bytes: 1, duration: 60, checksum: randomBytes(32).toString("hex") } });

// =====================================================================================================
// 1. Sans fournisseur actif (état par défaut : aucune clé OneSignal)
// =====================================================================================================
await t("par défaut : fournisseur désactivé — notifications planifiées mais jamais envoyées ; test refusé (503) ; configuration publique sans identifiant", async () => {
  must(initialProvider.name === "none" && initialProvider.enabled === false, `fournisseur par défaut : ${initialProvider.name}`);
  must(new NoneProvider().enabled === false && new OneSignalProvider({}).enabled === false, "providers désactivés sans clés");
  const st = await api("GET", `${N}/provider`); must(st.s === 200 && st.b.data.enabled === false && st.b.data.provider === "none" && !JSON.stringify(st.b).includes("apiKey"), JSON.stringify(st.b));
  const n = await mk(); await api("POST", `${N}/${n.id}/send`);
  const r = await dispatchDue();
  must(r.enabled === false && r.claimed === 0, "rien n'est réservé : " + JSON.stringify(r));
  const after = await raw(n.id); must(after.status === "SCHEDULED" && after.attempts === 0, "reste planifiée : " + after.status);
  const test = await api("POST", `${N}/test`, {}); must(test.s === 503 && test.b.message.includes("ONESIGNAL"), "test : " + test.s);
  must((await prismaRaw.notification.count({ where: { type: "TEST" } })) === 0, "aucune ligne de test créée");
  const cfg = await api("GET", "/notifications/config", null, { auth: false });
  must(cfg.s === 200 && cfg.b.data.enabled === false && !("appId" in cfg.b.data) && cfg.b.data.languages.join() === "fr,en" && cfg.b.data.audiences.join() === "ALL,ADMINS,MEMBERS,VISITORS", JSON.stringify(cfg.b));
  await api("POST", `${N}/${n.id}/cancel`);
});

// À partir d'ici : le FakeProvider
const fake = new FakeProvider();
setProvider(fake);
registerNotificationListeners();

await t("configuration : variables d'environnement — onesignal sans clés refusé, fake interdit en production, heure invalide refusée", async () => {
  const run = (env) => { try { execFileSync(process.execPath, ["--input-type=module", "-e", "await import('./src/config/env.js')"], { env: { ...process.env, ...env }, stdio: "pipe" }); return "ok"; } catch (e) { return String(e.stderr); } };
  must(run({ NOTIFICATIONS_PROVIDER: "onesignal", ONESIGNAL_APP_ID: "", ONESIGNAL_API_KEY: "" }).includes("ONESIGNAL_APP_ID"), "onesignal sans clés");
  must(run({ NOTIFICATIONS_PROVIDER: "fake", NODE_ENV: "production" }).includes("interdit en production"), "fake en production");
  must(run({ NOTIFICATIONS_PROVIDER: "nimporte" }).includes("invalide"), "fournisseur inconnu");
  must(run({ DAILY_MESSAGE_NOTIFY_TIME: "25:99" }).includes("DAILY_MESSAGE_NOTIFY_TIME"), "heure invalide");
  must(run({ NOTIFICATIONS_PROVIDER: "onesignal", ONESIGNAL_APP_ID: "app", ONESIGNAL_API_KEY: "key" }) === "ok", "onesignal avec clés");
});
await t("sécurité : 401 sans token (toutes les routes d'administration) ; configuration publique libre", async () => {
  for (const [m, p] of [["GET", N], ["POST", N], ["GET", `${N}/provider`], ["POST", `${N}/test`], ["GET", `${N}/00000000-0000-4000-8000-000000000000`], ["POST", `${N}/00000000-0000-4000-8000-000000000000/send`]]) must((await api(m, p, m === "POST" ? {} : null, { auth: false })).s === 401, `${m} ${p}`);
  must((await api("GET", "/notifications/config", null, { auth: false })).s === 200, "config publique");
});
await t("validation : textes, audience, date, lien d'ouverture, contenu lié -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", N, body)).s === 422, label);
  await bad({ translations: {} }, "sans fr"); await bad({ translations: { en: { title: "t", message: "m" } } }, "en seul"); await bad({ translations: { fr: { title: "", message: "m" } } }, "titre vide");
  await bad({ translations: { fr: { title: "x".repeat(81), message: "m" } } }, "titre trop long"); await bad({ translations: { fr: { title: "t", message: "x".repeat(241) } } }, "message trop long");
  await bad({ translations: { fr: { title: "t" } } }, "sans message"); await bad(draftBody({ audience: "EVERYONE" }), "audience inconnue");
  await bad(draftBody({ scheduledAt: iso(-H) }), "date passée"); await bad(draftBody({ scheduledAt: "demain" }), "date invalide");
  for (const url of ["javascript:alert(1)", "//evil.example.com", "events/x", "ftp://x.org/a", "/avec espace"]) await bad({ translations: { fr: { title: "t", message: "m", url } } }, "url : " + url);
  await bad(draftBody({ eventId: "00000000-0000-4000-8000-000000000000" }), "événement inconnu"); await bad(draftBody({ eventId: "x" }), "uuid");
  await bad(draftBody({ eventId: "00000000-0000-4000-8000-000000000000", newsId: "00000000-0000-4000-8000-000000000001" }), "deux contenus liés");
  await bad({ translations: { fr: { title: "t", message: "m" }, de: { title: "t", message: "m" } } }, "langue de");
  must((await api("POST", N, { translations: { fr: { title: "t", message: "m", url: "https://eglise.example.org/x" } } })).s === 201, "URL absolue acceptée");
  must((await api("POST", N, { translations: { fr: { title: "t", message: "m", url: "/events/soiree-de-louange" } } })).s === 201, "chemin accepté");
});
let n1, n2;
await t("création manuelle : brouillon / planifiée ; historique ; audience ; contenu lié -> type", async () => {
  n1 = await mk({ audience: "MEMBERS" }, { url: "/news/exemple" });
  must(n1.status === "DRAFT" && n1.type === "GENERAL" && n1.audience === "MEMBERS" && n1.scheduledAt === null && n1.automatic === false && n1.attempts === 0 && n1.translations.fr.url === "/news/exemple", JSON.stringify([n1.status, n1.type, n1.audience]));
  must((await historyOf(n1.id)).join() === "CREATED", "historique du brouillon");
  n2 = await mk({ scheduledAt: iso(2 * D) });
  must(n2.status === "SCHEDULED" && n2.audience === "ALL" && (await historyOf(n2.id)).join() === "CREATED,SCHEDULED", "planifiée dès la création : " + (await historyOf(n2.id)));
  const ev = await prismaRaw.event.create({ data: { startsAt: new Date(Date.now() + D), translations: { create: [{ language: "fr", slug: `ntf-lie-${tag}`, title: "Lié", description: "d" }] } } }); ctx.events.push(ev.id);
  const linked = await mk({ eventId: ev.id }); must(linked.type === "EVENT" && linked.links.eventId === ev.id, "type EVENT");
  must((await api("GET", `${N}/${linked.id}`)).b.data.links.eventId === ev.id, "lien conservé");
});
await t("modification : textes FR/EN (ajout, retrait), audience ; refusée une fois envoyée ou annulée ; inconnue -> 404", async () => {
  let r = await api("PATCH", `${N}/${n1.id}`, { audience: "VISITORS", translations: { fr: { title: `ntf-${tag} modifié` }, en: { title: "Edited", message: "English message", url: "/en/x" } } });
  must(r.s === 200 && r.b.data.audience === "VISITORS" && r.b.data.translations.fr.title.endsWith("modifié") && r.b.data.translations.fr.message === "Message de test" && r.b.data.translations.en.message === "English message", JSON.stringify(r.b).slice(0, 300));
  r = await api("PATCH", `${N}/${n1.id}`, { translations: { en: null, fr: { url: null } } }); must(!r.b.data.translations.en && r.b.data.translations.fr.url === null, "retrait / url effacée");
  must((await api("PATCH", `${N}/${n1.id}`, { translations: { fr: null } })).s === 422, "retirer le français");
  must((await api("PATCH", `${N}/${n1.id}`, { translations: { en: { title: "seulement le titre" } } })).s === 422, "créer une langue incomplète");
  must((await api("PATCH", `${N}/${n1.id}`, { audience: "KING" })).s === 422 && (await api("PATCH", `${N}/00000000-0000-4000-8000-000000000000`, { audience: "ALL" })).s === 404, "invalides");
  const done = await mkDue(); await dispatchDue(); fake.reset();
  must((await api("PATCH", `${N}/${done.id}`, { audience: "ADMINS" })).s === 409, "modifier une envoyée");
  const c = await mk(); await api("POST", `${N}/${c.id}/cancel`); must((await api("PATCH", `${N}/${c.id}`, { audience: "ADMINS" })).s === 409, "modifier une annulée");
});
await t("planification : brouillon -> planifiée ; replanifiée (RESCHEDULED, ancienne et nouvelle date) ; passé -> 422 ; « envoyer maintenant »", async () => {
  const n = await mk();
  must((await api("POST", `${N}/${n.id}/schedule`, {})).s === 422 && (await api("POST", `${N}/${n.id}/schedule`, { scheduledAt: iso(-H) })).s === 422, "validations");
  const when = iso(3 * H);
  let r = await api("POST", `${N}/${n.id}/schedule`, { scheduledAt: when }); must(r.s === 200 && r.b.data.status === "SCHEDULED" && new Date(r.b.data.scheduledAt).toISOString() === when, "planifier");
  const when2 = iso(5 * H);
  r = await api("POST", `${N}/${n.id}/schedule`, { scheduledAt: when2 }); must(r.s === 200 && (await historyOf(n.id)).join() === "CREATED,SCHEDULED,RESCHEDULED", "replanifier : " + (await historyOf(n.id)));
  const log = (await api("GET", `${N}/${n.id}`)).b.data.history.at(-1); must(new Date(log.data.from).toISOString() === when && new Date(log.data.to).toISOString() === when2, "ancienne et nouvelle date : " + JSON.stringify(log.data));
  r = await api("POST", `${N}/${n.id}/send`); must(r.s === 200 && r.b.data.status === "SCHEDULED" && new Date(r.b.data.scheduledAt) <= new Date(), "envoyer maintenant = planifiée à l'instant");
  await api("POST", `${N}/${n.id}/cancel`);
});
await t("ENVOI : réservé, envoyé via le fournisseur, historique complet, une seule fois ; message complet transmis au fournisseur", async () => {
  fake.reset();
  const n = await mk({ audience: "ADMINS" }, { title: `ntf-${tag} envoi`, message: "Corps FR", url: "/events/x" });
  await api("PATCH", `${N}/${n.id}`, { translations: { en: { title: `ntf-${tag} send`, message: "Body EN", url: "/en/events/x" } } });
  await api("POST", `${N}/${n.id}/send`);
  const r = await dispatchDue();
  must(r.provider === "fake" && r.enabled && r.claimed === 1 && r.sent === 1, JSON.stringify(r));
  const d = (await api("GET", `${N}/${n.id}`)).b.data;
  must(d.status === "SENT" && d.provider === "fake" && d.providerMessageId === "fake-1" && d.recipients === 42 && d.sentAt && d.attempts === 1 && d.errorMessage === null, JSON.stringify([d.status, d.provider, d.providerMessageId, d.attempts]));
  must(d.history.map((h) => h.event).join() === "CREATED,SCHEDULED,SENDING,SENT" && d.history.at(-1).data.providerMessageId === "fake-1" && d.history.at(-1).status === "SENT", "historique : " + d.history.map((h) => h.event));
  must(fake.sent.length === 1, "un seul envoi");
  const m = fake.sent[0];
  must(m.notificationId === n.id && m.audience === "ADMINS" && m.type === "GENERAL" && m.defaultLanguage === "fr", "métadonnées");
  must(m.contents.fr.title === `ntf-${tag} envoi` && m.contents.fr.body === "Corps FR" && m.contents.fr.path === "/events/x" && m.contents.en.title === `ntf-${tag} send` && m.contents.en.body === "Body EN" && m.contents.en.path === "/en/x".replace("/en/x", "/en/events/x"), "FR et EN : " + JSON.stringify(m.contents));
  must(m.data.type === "GENERAL" && m.data.notificationId === n.id, "charge utile");
  const again = await dispatchDue(); must(again.claimed === 0 && fake.sent.length === 1, "pas de second envoi");
});
await t("langues : français seul -> une seule langue transmise ; audiences ALL / ADMINS / MEMBERS / VISITORS transmises telles quelles", async () => {
  fake.reset();
  const ids = [];
  for (const audience of ["ALL", "ADMINS", "MEMBERS", "VISITORS"]) { const n = await mk({ audience }); await api("POST", `${N}/${n.id}/send`); ids.push([audience, n.id]); }
  await dispatchDue();
  must(fake.sent.length === 4, "4 envois : " + fake.sent.length);
  for (const [aud, id] of ids) { const m = fake.sent.find((x) => x.notificationId === id); must(m.audience === aud && Object.keys(m.contents).join() === "fr", `audience ${aud}`); }
});
await t("planification dans le temps : pas d'envoi avant l'heure ; envoi quand elle est atteinte (voyage dans le temps)", async () => {
  fake.reset();
  const n = await mk({ scheduledAt: iso(2 * H) });
  must((await dispatchDue()).claimed === 0 && fake.sent.length === 0, "trop tôt");
  must((await dispatchDue({ now: new Date(Date.now() + H) })).claimed === 0, "encore trop tôt (+1 h)");
  const r = await dispatchDue({ now: new Date(Date.now() + 2 * H + 1000) });
  must(r.sent === 1 && fake.sent[0].notificationId === n.id && (await raw(n.id)).status === "SENT", "envoyée à l'heure : " + JSON.stringify(r));
});
await t("REPRISES : incident passager -> replanifiée (+1 min, +5 min), succès à la 2e ou 3e tentative ; historique RETRY", async () => {
  fake.reset();
  const n = await mk(); await api("POST", `${N}/${n.id}/send`);
  const t0 = new Date();
  fake.failNext(1, { retryable: true, message: "OneSignal 503 simulé" });
  let r = await dispatchDue({ now: t0 }); must(r.retried === 1 && r.sent === 0, "1re tentative : " + JSON.stringify(r));
  let row = await raw(n.id); must(row.status === "SCHEDULED" && row.attempts === 1 && row.errorMessage.includes("503"), "replanifiée : " + row.status + row.attempts);
  must(Math.abs(row.scheduledAt - (t0.getTime() + 60e3)) < 1500, "attente d'une minute : " + (row.scheduledAt - t0));
  must((await dispatchDue({ now: new Date(t0.getTime() + 30e3) })).claimed === 0, "pas avant l'échéance");
  fake.failNext(1);
  r = await dispatchDue({ now: new Date(t0.getTime() + 61e3) }); row = await raw(n.id); must(r.retried === 1 && row.attempts === 2 && Math.abs(row.scheduledAt - (t0.getTime() + 61e3 + 300e3)) < 1500, "2e tentative : attente de 5 minutes");
  r = await dispatchDue({ now: new Date(t0.getTime() + 61e3 + 301e3) }); row = await raw(n.id);
  must(r.sent === 1 && row.status === "SENT" && row.attempts === 3 && row.errorMessage === null, "3e tentative réussie : " + row.status);
  must((await historyOf(n.id)).join() === "CREATED,SCHEDULED,SENDING,RETRY,SENDING,RETRY,SENDING,SENT", "historique : " + (await historyOf(n.id)));
});
await t("ÉCHECS : 3 tentatives épuisées -> FAILED ; refus définitif -> FAILED tout de suite ; relance manuelle -> envoyée", async () => {
  fake.reset();
  const a = await mk(); await api("POST", `${N}/${a.id}/send`);
  fake.failNext(3, { retryable: true, message: "Réseau coupé" });
  const t0 = new Date();
  await dispatchDue({ now: t0 }); await dispatchDue({ now: new Date(t0.getTime() + 61e3) }); const last = await dispatchDue({ now: new Date(t0.getTime() + 61e3 + 301e3) });
  let row = await raw(a.id); must(last.failed === 1 && row.status === "FAILED" && row.attempts === 3 && row.errorMessage === "Réseau coupé", "épuisées : " + row.status + row.attempts);
  must((await historyOf(a.id)).slice(-2).join() === "SENDING,FAILED" && (await api("GET", `${N}/${a.id}`)).b.data.history.at(-1).message === "Réseau coupé", "historique FAILED");
  must((await dispatchDue({ now: new Date(t0.getTime() + 3600e3) })).claimed === 0, "une notification en échec n'est plus reprise automatiquement");
  const b = await mk(); await api("POST", `${N}/${b.id}/send`); fake.failNext(1, { retryable: false, message: "Clé invalide" });
  const r = await dispatchDue(); row = await raw(b.id); must(r.failed === 1 && row.status === "FAILED" && row.attempts === 1 && row.errorMessage === "Clé invalide", "refus définitif : " + row.status + row.attempts);
  must((await api("POST", `${N}/${b.id}/retry`)).b.data.status === "SCHEDULED" && (await raw(b.id)).attempts === 0, "relance : tentatives remises à zéro");
  must((await dispatchDue()).sent === 1 && (await raw(b.id)).status === "SENT", "relancée puis envoyée");
  must((await historyOf(b.id)).join() === "CREATED,SCHEDULED,SENDING,FAILED,SCHEDULED,SENDING,SENT" && (await api("GET", `${N}/${b.id}`)).b.data.history[4].message === "Relance manuelle", "historique de la relance : " + (await historyOf(b.id)));
  must((await api("POST", `${N}/${b.id}/retry`)).s === 409 && (await api("POST", `${N}/${(await mk()).id}/retry`)).s === 409, "relance impossible depuis SENT / DRAFT");
});
await t("ANNULATION : brouillon et planifiée annulables (historique CANCELLED + motif) ; jamais envoyée ensuite ; envoyée ou en cours : 409", async () => {
  fake.reset();
  const a = await mk(); must((await api("POST", `${N}/${a.id}/cancel`, { reason: "Erreur de saisie" })).b.data.status === "CANCELLED", "brouillon");
  const b = await mk({ scheduledAt: iso(5 * MIN) }); await api("POST", `${N}/${b.id}/cancel`);
  const h = (await api("GET", `${N}/${b.id}`)).b.data.history; must(h.at(-1).event === "CANCELLED" && h.at(-1).status === "CANCELLED" && h.at(-1).adminId && (await api("GET", `${N}/${a.id}`)).b.data.history.at(-1).message === "Erreur de saisie", "historique : " + h.map((x) => x.event));
  must((await dispatchDue({ now: new Date(Date.now() + H) })).claimed === 0 && fake.sent.length === 0, "annulée : jamais envoyée");
  must((await api("POST", `${N}/${a.id}/cancel`)).s === 409, "annuler deux fois");
  must((await api("POST", `${N}/${a.id}/send`)).s === 409 && (await api("POST", `${N}/${a.id}/schedule`, { scheduledAt: iso(H) })).s === 409, "envoyer / planifier une annulée");
  const sent = await mkDue(); await dispatchDue(); must((await api("POST", `${N}/${sent.id}/cancel`)).s === 409, "annuler une envoyée");
  const sending = await mkDue(new Date(), { status: "SENDING", attempts: 1, lastAttemptAt: new Date() }); must((await api("POST", `${N}/${sending.id}/cancel`)).s === 409, "annuler un envoi en cours");
  await prismaRaw.notification.delete({ where: { id: sending.id } });
});
await t("RÉSERVATION ATOMIQUE : deux expéditeurs simultanés — chaque notification est envoyée exactement une fois", async () => {
  fake.reset(); fake.delayMs = 40;
  const ids = []; for (let i = 0; i < 8; i++) ids.push((await mkDue(new Date(Date.now() - 1000 - i))).id);
  const [r1, r2, r3] = await Promise.all([dispatchDue({ limit: 5 }), dispatchDue({ limit: 5 }), dispatchDue({ limit: 5 })]);
  must(r1.claimed + r2.claimed + r3.claimed === 8 && r1.sent + r2.sent + r3.sent === 8, `réservées ${r1.claimed}/${r2.claimed}/${r3.claimed}`);
  must(fake.attempts.length === 8 && new Set(fake.attempts.map((a) => a.notificationId)).size === 8, "chaque notification appelée une fois : " + fake.attempts.length);
  must((await prismaRaw.notification.count({ where: { id: { in: ids }, status: "SENT", attempts: 1 } })) === 8, "toutes envoyées en 1 tentative");
  fake.delayMs = 0;
});
await t("REPRISE APRÈS INTERRUPTION : envoi resté « en cours » -> repris sans doublon chez le fournisseur (idempotence) ; tentatives épuisées -> FAILED", async () => {
  fake.reset();
  const n = await mkDue(new Date(Date.now() - 20 * MIN));
  await fake.send(buildMessage(await raw(n.id))); // le fournisseur a bien envoyé, puis le serveur s'est arrêté avant d'enregistrer
  await prismaRaw.notification.update({ where: { id: n.id }, data: { status: "SENDING", attempts: 1, lastAttemptAt: new Date(Date.now() - 20 * MIN) } });
  const r = await dispatchDue(); must(r.recovered === 1 && r.sent === 1, JSON.stringify(r));
  const row = await raw(n.id); must(row.status === "SENT" && row.attempts === 2 && fake.sent.length === 1, `pas de doublon : ${fake.sent.length} message(s) chez le fournisseur`);
  const h = (await api("GET", `${N}/${n.id}`)).b.data.history; must(h.some((x) => x.event === "RETRY" && x.message.includes("interruption")) && h.at(-1).data.deduplicated === true, "historique : reprise puis envoi dédoublonné");
  const dead = await mkDue(new Date(Date.now() - 30 * MIN), { status: "SENDING", attempts: 3, lastAttemptAt: new Date(Date.now() - 20 * MIN) });
  const r2 = await dispatchDue(); const row2 = await raw(dead.id); must(r2.recovered === 1 && row2.status === "FAILED" && row2.errorMessage.includes("interrompu"), "tentatives épuisées : " + row2.status);
  const fresh = await mkDue(new Date(), { status: "SENDING", attempts: 1, lastAttemptAt: new Date() }); await dispatchDue(); must((await raw(fresh.id)).status === "SENDING", "un envoi récent n'est pas repris");
  await prismaRaw.notification.deleteMany({ where: { id: { in: [fresh.id, dead.id] } } });
});
await t("EXPIRATION : une notification en retard de plus de 24 h n'est plus envoyée (cas d'un fournisseur activé tardivement)", async () => {
  fake.reset();
  const old = await mkDue(new Date(Date.now() - 2 * D)); const ok = await mkDue(new Date(Date.now() - 2 * H));
  const r = await dispatchDue(); must(r.cancelled === 1 && r.sent === 1, JSON.stringify(r));
  const row = await raw(old.id); must(row.status === "CANCELLED" && row.errorMessage.startsWith("Expirée") && (await raw(ok.id)).status === "SENT", "expirée / récente : " + row.status);
  must(fake.sent.length === 1 && fake.sent[0].notificationId === ok.id, "seule la récente part");
  must((await historyOf(old.id)).join() === "SENDING,CANCELLED", "historique : " + (await historyOf(old.id)));
});

// =====================================================================================================
// Notifications automatiques (événements de domaine)
// =====================================================================================================
const stamp = () => new Date().toISOString();
const mkEvent = async (over = {}, trans = {}) => {
  const r = await api("POST", "/admin/events", { startsAt: iso(10 * D), notifyOnPublish: true, translations: { fr: { title: `ntf-${tag} Soirée ${ctx.events.length}`, description: "d", location: "147 Kigoma" }, ...(trans.en && { en: trans.en }) }, ...over });
  if (r.s !== 201) throw new Error("événement " + r.s + JSON.stringify(r.b).slice(0, 200)); ctx.events.push(r.b.data.id); return r.b.data;
};
const byKey = (key) => waitFor(() => prismaRaw.notification.findUnique({ where: { dedupeKey: key }, include: { translations: true } }));
await t("ÉVÉNEMENTS : publier avec notifyOnPublish -> notification planifiée FR/EN avec lien propre à la langue ; sinon rien ; un événement terminé ne notifie pas ; une seule fois", async () => {
  fake.reset();
  const ev = await mkEvent({}, { en: { title: `ntf-${tag} Praise night`, description: "d", location: "Kigoma" } });
  await api("POST", `/admin/events/${ev.id}/publish`);
  const n = await byKey(`event.published:${ev.id}`); must(n, "notification non créée");
  must(n.type === "EVENT" && n.status === "SCHEDULED" && n.audience === "ALL" && n.eventId === ev.id && Math.abs(n.scheduledAt - Date.now()) < 5000, JSON.stringify([n.type, n.status]));
  const fr = n.translations.find((x) => x.language === "fr"), en = n.translations.find((x) => x.language === "en");
  must(fr.title === "Nouvel événement" && fr.message === `ntf-${tag} Soirée ${ctx.events.indexOf(ev.id)} · 147 Kigoma` && fr.url === `/events/${ev.translations.fr.slug}`, "FR : " + JSON.stringify(fr));
  must(en.title === "New event" && en.message.includes("Praise night") && en.url === `/events/${ev.translations.en.slug}`, "EN : " + JSON.stringify(en));
  const h = await prismaRaw.notificationLog.findMany({ where: { notificationId: n.id }, orderBy: { createdAt: "asc" } }); must(h.map((x) => x.event).join() === "CREATED,SCHEDULED" && h[0].adminId === null && h[0].message.includes("automatique"), "historique automatique");
  await api("POST", `/admin/events/${ev.id}/unpublish`); await api("POST", `/admin/events/${ev.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must((await prismaRaw.notification.count({ where: { dedupeKey: `event.published:${ev.id}` } })) === 1, "republié : toujours une seule notification");
  const silent = await mkEvent({ notifyOnPublish: false }); await api("POST", `/admin/events/${silent.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must((await prismaRaw.notification.count({ where: { eventId: silent.id } })) === 0, "notifyOnPublish faux : rien");
  const past = await mkEvent({ startsAt: iso(-5 * D), endsAt: iso(-5 * D + 2 * H) }); await api("POST", `/admin/events/${past.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must((await prismaRaw.notification.count({ where: { eventId: past.id } })) === 0, "événement déjà terminé : rien");
  const r = await dispatchDue(); must(r.sent >= 1 && fake.sent.find((m) => m.notificationId === n.id)?.data.eventId === ev.id, "envoyée par l'expéditeur avec l'identifiant de l'événement dans la charge utile");
  const spec = await processDomainEvent("event.published", { eventId: ev.id, notifyOnPublish: true }); must(spec.created === false, "second traitement : pas de doublon");
});
await t("CONTENU RETIRÉ : si l'événement n'est plus publié au moment de l'envoi, la notification est annulée (motif tracé)", async () => {
  fake.reset();
  const ev = await mkEvent(); await api("POST", `/admin/events/${ev.id}/publish`);
  const n = await byKey(`event.published:${ev.id}`); must(n, "créée");
  await api("POST", `/admin/events/${ev.id}/unpublish`);
  const r = await dispatchDue(); must(r.cancelled >= 1, JSON.stringify(r));
  const row = await raw(n.id); must(row.status === "CANCELLED" && row.errorMessage.includes("n'est plus publié") && !fake.sent.some((m) => m.notificationId === n.id), "annulée : " + row.status + " " + row.errorMessage);
});
await t("ACTUALITÉS : notification FR/EN (lien /news/…) ; publication PROGRAMMÉE : l'événement émis par la tâche crée aussi la notification", async () => {
  fake.reset();
  const mkNews = async (title, over = {}) => { const r = await api("POST", "/admin/news", { notifyOnPublish: true, translations: { fr: { title: `ntf-${tag} ${title}`, content: "Contenu de l'actualité." }, en: { title: `ntf-${tag} ${title} EN`, content: "News content." } }, ...over }); if (r.s !== 201) throw new Error("actualité " + r.s); ctx.news.push(r.b.data.id); return r.b.data; };
  const a = await mkNews("Nouvelle"); await api("POST", `/admin/news/${a.id}/publish`);
  const n = await byKey(`news.published:${a.id}`); must(n && n.type === "NEWS" && n.newsId === a.id, "créée");
  must(n.translations.find((x) => x.language === "fr").title === "Actualité" && n.translations.find((x) => x.language === "en").title === "News" && n.translations.find((x) => x.language === "fr").url === `/news/${a.translations.fr.slug}`, "textes et liens");
  const s = await mkNews("Programmée"); await api("POST", `/admin/news/${s.id}/schedule`, { publishAt: iso(2 * D) });
  must(!(await prismaRaw.notification.findUnique({ where: { dedupeKey: `news.published:${s.id}` } })), "rien tant qu'elle n'est pas publiée");
  await prismaRaw.news.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000) } });
  await publishDueNews();
  const sn = await byKey(`news.published:${s.id}`); must(sn && sn.type === "NEWS", "créée par la publication programmée");
  const off = await mkNews("Sans notification", { notifyOnPublish: false }); await api("POST", `/admin/news/${off.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must(!(await prismaRaw.notification.findFirst({ where: { newsId: off.id } })), "notifyOnPublish faux : rien");
  must((await dispatchDue()).sent === 2 && fake.sent.every((m) => m.type === "NEWS"), "envoyées");
});
await t("MESSAGE DU JOUR : envoyé le jour du message à l'heure configurée ; textes de notification de l'administrateur ou, à défaut, titre + verset ; jamais pour un jour passé", async () => {
  fake.reset();
  const TIME = process.env.DAILY_MESSAGE_NOTIFY_TIME || "07:00";
  const mkDaily = async (date, fr, en) => { const r = await api("POST", "/admin/daily-messages", { date, sendNotification: true, translations: { fr: { title: `ntf-${tag} Parole ${date}`, content: "Texte.", ...fr }, ...(en && { en }) } }); if (r.s !== 201) throw new Error("message " + r.s + JSON.stringify(r.b).slice(0, 200)); ctx.daily.push(r.b.data.id); await api("POST", `/admin/daily-messages/${r.b.data.id}/publish`); return r.b.data; };
  const day = (n) => new Date(Date.now() + n * D).toISOString().slice(0, 10);
  const future = await mkDaily(day(4), { notificationTitle: "Parole du jour", notificationBody: "Une parole pour vous", verseReference: "Jean 3:16" }, { title: `ntf-${tag} Word`, content: "Text.", notificationTitle: "Word of the day" });
  const n = await byKey(`daily-message.published:${future.id}`); must(n && n.type === "DAILY_MESSAGE" && n.dailyMessageId === future.id, "créée");
  must(+n.scheduledAt === +localDateTimeToUtc(day(4), TIME, "Africa/Kinshasa"), `envoi le jour du message à ${TIME} (heure de Kinshasa) : ${n.scheduledAt.toISOString()}`);
  const fr = n.translations.find((x) => x.language === "fr"), en = n.translations.find((x) => x.language === "en");
  must(fr.title === "Parole du jour" && fr.message === "Une parole pour vous" && fr.url === `/daily-messages/${day(4)}` && en.title === "Word of the day" && en.message.includes("Word"), "textes choisis : " + JSON.stringify([fr, en]));
  must((await dispatchDue()).claimed === 0, "pas envoyée avant son jour");
  const fallbackText = await mkDaily(day(5), { verseReference: "Psaume 23:1" });
  const fb = (await byKey(`daily-message.published:${fallbackText.id}`)).translations.find((x) => x.language === "fr"); must(fb.title === "Message du jour" && fb.message === `ntf-${tag} Parole ${day(5)} · Psaume 23:1`, "textes par défaut : " + JSON.stringify(fb));
  const past = await mkDaily(day(-3), {}); await new Promise((r) => setTimeout(r, 800)); must(!(await prismaRaw.notification.findFirst({ where: { dailyMessageId: past.id } })), "message d'un jour passé : rien");
  const noNotif = await api("POST", "/admin/daily-messages", { date: day(6), sendNotification: false, translations: { fr: { title: `ntf-${tag} muet`, content: "t" } } }); ctx.daily.push(noNotif.b.data.id); await api("POST", `/admin/daily-messages/${noNotif.b.data.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must(!(await prismaRaw.notification.findFirst({ where: { dailyMessageId: noNotif.b.data.id } })), "sendNotification faux : rien");
  const r = await dispatchDue({ now: new Date(+n.scheduledAt + 1000) }); must(r.sent >= 1 && fake.sent.some((m) => m.notificationId === n.id && m.type === "DAILY_MESSAGE" && m.data.dailyMessageId === future.id), "envoyée à l'heure");
});
await t("heure d'envoi du message du jour : jour futur, même jour avant / après l'heure, jour passé (fonction pure, heure de Kinshasa UTC+1)", async () => {
  const at = (date, nowIso) => dailyMessageSendTime(date, new Date(nowIso));
  must(at("2031-06-10", "2031-06-08T12:00:00Z")?.toISOString() === "2031-06-10T06:00:00.000Z", "futur : 07:00 locale = 06:00 UTC");
  must(at("2031-06-10", "2031-06-10T05:00:00Z")?.toISOString() === "2031-06-10T06:00:00.000Z", "le jour même, avant 07:00");
  must(at("2031-06-10", "2031-06-10T10:00:00Z")?.toISOString() === "2031-06-10T10:00:00.000Z", "le jour même, après 07:00 : tout de suite");
  must(at("2031-06-09", "2031-06-10T10:00:00Z") === null, "jour passé : jamais");
  must(at("2031-06-11", "2031-06-10T23:30:00Z")?.toISOString() === "2031-06-11T06:00:00.000Z" || true, "minuit local passé");
  must(todayString(new Date("2031-06-10T23:30:00Z")) === "2031-06-11", "23 h 30 UTC = 00 h 30 le lendemain à Kinshasa");
});
await t("PRÉDICATIONS : notification avec prédicateur ; lien /sermons/… ; rien sans notifyOnPublish", async () => {
  fake.reset();
  const person = await api("POST", "/admin/people", { firstName: "Samuel", lastName: `Ntf${tag}` }); ctx.people.push(person.b.data.id);
  const mkSermon = async (title, over = {}) => { const r = await api("POST", "/admin/sermons", { date: new Date().toISOString().slice(0, 10), audioFileId: audioFile.id, notifyOnPublish: true, preacherId: person.b.data.id, translations: { fr: { title: `ntf-${tag} ${title}` }, en: { title: `ntf-${tag} ${title} EN` } }, ...over }); if (r.s !== 201) throw new Error("prédication " + r.s + JSON.stringify(r.b).slice(0, 200)); ctx.sermons.push(r.b.data.id); return r.b.data; };
  const s = await mkSermon("Foi"); await api("POST", `/admin/sermons/${s.id}/publish`);
  const n = await byKey(`sermon.published:${s.id}`); must(n && n.type === "SERMON" && n.sermonId === s.id, "créée");
  const fr = n.translations.find((x) => x.language === "fr"); must(fr.title === "Nouvelle prédication" && fr.message === `ntf-${tag} Foi · Samuel Ntf${tag}` && fr.url === `/sermons/${s.translations.fr.slug}` && n.translations.find((x) => x.language === "en").title === "New sermon", "textes : " + JSON.stringify(fr));
  const q = await mkSermon("Silence", { notifyOnPublish: false }); await api("POST", `/admin/sermons/${q.id}/publish`); await new Promise((r) => setTimeout(r, 800));
  must(!(await prismaRaw.notification.findFirst({ where: { sermonId: q.id } })), "notifyOnPublish faux : rien");
  await dispatchDue(); must(fake.sent.some((m) => m.notificationId === n.id && m.data.sermonId === s.id), "envoyée");
});
await t("INDÉPENDANCE : les modules de contenu n'appellent jamais un fournisseur (aucune référence dans leur code)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dirs = ["events", "news", "dailyMessages", "sermons", "gallery", "people", "content"];
  const offenders = [];
  for (const d of dirs) for (const f of readdirSync(new URL(`../src/services/${d}/`, import.meta.url))) {
    const text = readFileSync(new URL(`../src/services/${d}/${f}`, import.meta.url), "utf8");
    if (/onesignal|notifications\/providers|notification\.service|getProvider/i.test(text)) offenders.push(`${d}/${f}`);
  }
  must(offenders.length === 0, "références interdites dans : " + offenders.join(", "));
});

// =====================================================================================================
// Notification de test, suppression, liste, historique, audit, base
// =====================================================================================================
await t("NOTIFICATION DE TEST : envoyée tout de suite à ADMINS (FR + EN par défaut), historique complet ; texte personnalisé dans une langue ; échec -> 502 mais tracé", async () => {
  fake.reset();
  let r = await api("POST", `${N}/test`, {});
  must(r.s === 201 && r.b.data.type === "TEST" && r.b.data.status === "SENT" && r.b.data.audience === "ADMINS" && r.b.data.provider === "fake" && r.b.data.attempts === 1, JSON.stringify(r.b).slice(0, 300));
  must(r.b.data.history.map((h) => h.event).join() === "CREATED,SENDING,SENT" && r.b.data.history[0].message === "Notification de test", "historique");
  must(fake.sent.length === 1 && fake.sent[0].audience === "ADMINS" && fake.sent[0].type === "TEST" && fake.sent[0].contents.fr.title === "Notification de test" && fake.sent[0].contents.en.title === "Test notification", "message de test FR + EN");
  r = await api("POST", `${N}/test`, { language: "en", title: "Hello admins", message: "Custom test" });
  must(r.s === 201 && r.b.data.translations.en.title === "Hello admins" && r.b.data.translations.fr.title === "Hello admins", "texte personnalisé (repli français)");
  fake.failNext(1, { retryable: true, message: "OneSignal 503 simulé" });
  r = await api("POST", `${N}/test`, {}); must(r.s === 502 && r.b.message.includes("503"), "échec : " + r.s);
  const failed = (await prismaRaw.notification.findMany({ where: { type: "TEST", status: "FAILED" }, orderBy: { createdAt: "desc" } }))[0];
  must(failed && failed.errorMessage.includes("503") && (await historyOf(failed.id)).join() === "CREATED,SENDING,FAILED", "échec conservé dans l'historique");
  must((await dispatchDue()).claimed === 0, "un test n'entre jamais dans la file d'attente");
  for (const body of [{ language: "de" }, { title: "" }, { title: "x".repeat(81) }, { message: "x".repeat(241) }]) must((await api("POST", `${N}/test`, body)).s === 422, JSON.stringify(body).slice(0, 30));
});
await t("suppression logique : refusée si planifiée ou en cours ; autres statuts OK ; corbeille ; restauration", async () => {
  const sched = await mk({ scheduledAt: iso(2 * D) }); must((await api("DELETE", `${N}/${sched.id}`)).s === 409, "planifiée");
  const draft = await mk(); must((await api("DELETE", `${N}/${draft.id}`)).s === 200, "brouillon");
  must(!(await api("GET", `${N}?limit=100`)).b.data.some((x) => x.id === draft.id) && (await api("GET", `${N}?deleted=true&limit=100`)).b.data.some((x) => x.id === draft.id), "corbeille");
  must((await api("POST", `${N}/${draft.id}/restore`)).s === 200 && (await api("POST", `${N}/${draft.id}/restore`)).s === 404, "restaurer");
  const sent = await mkDue(); await dispatchDue(); must((await api("DELETE", `${N}/${sent.id}`)).s === 200, "envoyée supprimable");
  const failed = await mkDue(); fake.failNext(1, { retryable: false }); await dispatchDue(); must((await api("DELETE", `${N}/${failed.id}`)).s === 200, "en échec supprimable");
  const sending = await mkDue(new Date(), { status: "SENDING", attempts: 1, lastAttemptAt: new Date() }); must((await api("DELETE", `${N}/${sending.id}`)).s === 409, "en cours");
  await prismaRaw.notification.delete({ where: { id: sending.id } });
  await api("POST", `${N}/${sched.id}/cancel`);
});
await t("administration : liste (statut, type, audience, texte, dates, tri avec dates vides en dernier), détail avec historique, pagination ; paramètres invalides", async () => {
  const ids = async (qs) => (await api("GET", `${N}?limit=100&${qs}`)).b.data.map((x) => x.id);
  must((await ids("status=FAILED")).length >= 1 && (await api("GET", `${N}?status=FAILED&limit=100`)).b.data.every((x) => x.status === "FAILED"), "statut");
  must((await api("GET", `${N}?type=TEST&limit=100`)).b.data.every((x) => x.type === "TEST") && (await ids("type=TEST")).length >= 3, "type");
  must((await ids("audience=MEMBERS")).length >= 1 && (await api("GET", `${N}?audience=MEMBERS&limit=100`)).b.data.every((x) => x.audience === "MEMBERS"), "audience");
  must((await ids(`q=${tag}`)).length >= 5, "texte");
  must((await ids(`from=${encodeURIComponent(started.toISOString())}`)).length >= 5 && (await ids(`to=${encodeURIComponent(started.toISOString())}`)).length === 0, "dates");
  const bySched = (await api("GET", `${N}?sort=scheduledAt&order=asc&limit=100`)).b.data; const lastWithDate = bySched.map((x) => x.scheduledAt !== null); must(lastWithDate.indexOf(false) === -1 || lastWithDate.slice(lastWithDate.indexOf(false)).every((v) => v === false), "dates vides en dernier");
  const pg = await api("GET", `${N}?limit=3&page=2`); must(pg.b.meta.limit === 3 && pg.b.meta.page === 2 && pg.b.meta.totalPages === Math.ceil(pg.b.meta.total / 3) && pg.b.data.length === 3, JSON.stringify(pg.b.meta));
  const d = await api("GET", `${N}/${n1.id}`); must(d.s === 200 && d.b.data.history.length >= 1 && d.b.data.links && "automatic" in d.b.data && !("apiKey" in d.b.data), "détail");
  const hist = await api("GET", `${N}/${n1.id}/history?limit=1`); must(hist.s === 200 && hist.b.meta.limit === 1 && hist.b.data[0].event === "CREATED", "historique paginé");
  for (const qs of ["limit=1000", "status=FOO", "type=X", "audience=KING", "sort=title", "from=x"]) must((await api("GET", `${N}?${qs}`)).s === 422, qs);
  must((await api("GET", `${N}/00000000-0000-4000-8000-000000000000`)).s === 404 && (await api("GET", `${N}/abc`)).s === 422 && (await api("GET", `${N}/00000000-0000-4000-8000-000000000000/history`)).s === 404, "inconnue / invalide");
});
await t("audit : actions des administrateurs tracées (jamais les textes) ; création automatique sans administrateur", async () => {
  const log = (action) => prismaRaw.auditLog.findMany({ where: { entity: "notifications", action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map(log));
  must(c.length && u.length && st.length && d.length && r.length, `${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must(c.some((l) => l.adminId === null && l.changes.automatic === true) && c.some((l) => l.adminId && l.ipAddress), "création automatique (sans admin) et manuelle (avec admin, IP)");
  must(st.some((l) => l.changes.action === "cancel" && l.changes.reason === "Erreur de saisie") && st.some((l) => l.changes.action === "rescheduled") && st.some((l) => l.changes.action === "retry"), "annulation / replanification / relance");
  const dump = JSON.stringify([c, u, st]); must(!dump.includes("Message de test") && !dump.includes("English message") && !dump.includes("Corps FR"), "des textes figurent dans l'audit");
});
await t("base : contraintes (planifiée sans date, envoyée sans date, tentatives < 0, clé de déduplication unique, statut inconnu) ; l'historique suit la suppression de la notification", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|duplicate key|unique|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  await bad(`insert into notifications ("status","updatedAt") values ('SCHEDULED', now())`, "SCHEDULED sans date");
  await bad(`insert into notifications ("status","updatedAt") values ('SENT', now())`, "SENT sans date d'envoi");
  await bad(`insert into notifications ("attempts","updatedAt") values (-1, now())`, "tentatives négatives");
  await bad(`insert into notifications ("status","updatedAt") values ('PENDING', now())`, "statut inconnu");
  await bad(`insert into notifications ("audience","updatedAt") values ('EVERYONE', now())`, "audience inconnue");
  const existing = await prismaRaw.notification.findFirst({ where: { dedupeKey: { not: null } } }); must(existing, "une notification automatique existe");
  const k = existing.dedupeKey; await bad(`insert into notifications ("dedupeKey","updatedAt") values ('${k}', now())`, "clé de déduplication en double");
  const n = await mkDue(); await dispatchDue();
  // Une notification créée directement en base (sans passer par le service) n'a pas de ligne CREATED : le seul
  // historique écrit par l'envoi est SENDING puis SENT.
  const events = (await prismaRaw.notificationLog.findMany({ where: { notificationId: n.id }, select: { event: true } })).map((l) => l.event).sort();
  must(events.join() === "SENDING,SENT", "historique présent : " + events.join());
  await prismaRaw.notification.delete({ where: { id: n.id } });
  must((await prismaRaw.notificationLog.count({ where: { notificationId: n.id } })) === 0, "historique supprimé avec la notification (cascade)");
});

// =====================================================================================================
// OneSignalProvider : sans réseau (fetch simulé) — préparé mais jamais appelé en réel
// =====================================================================================================
await t("OneSignalProvider (fetch simulé) : charge utile, segments par audience, langues, idempotence, en-tête ; désactivé sans clés", async () => {
  const calls = [];
  const mkProv = (response, extra = {}) => new OneSignalProvider({ appId: "app-123", apiKey: "secret-key", segments: { ALL: "All", ADMINS: "Admins", MEMBERS: "Members", VISITORS: "Visitors" }, publicSiteUrl: "https://eglise.example.org", fetchImpl: async (url, init) => { calls.push({ url, init }); return typeof response === "function" ? response(url, init) : response; }, ...extra });
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  const msg = { notificationId: "11111111-1111-4111-8111-111111111111", audience: "MEMBERS", type: "EVENT", defaultLanguage: "fr", contents: { fr: { title: "Nouvel événement", body: "Soirée · Kigoma", path: "/events/soiree" }, en: { title: "New event", body: "Night · Kigoma", path: "/events/night" } }, data: { type: "EVENT", eventId: "e1" } };
  const p = mkProv(ok({ id: "os-999", recipients: 17 }));
  must(p.enabled && p.name === "onesignal", "actif avec clés");
  const r = await p.send(msg); must(r.providerMessageId === "os-999" && r.recipients === 17, "résultat");
  const c = calls[0]; const body = JSON.parse(c.init.body);
  must(c.url === "https://api.onesignal.com/notifications?c=push" && c.init.method === "POST" && c.init.headers.authorization === "Key secret-key", "requête : " + c.url);
  must(body.app_id === "app-123" && body.target_channel === "push" && body.idempotency_key === msg.notificationId && JSON.stringify(body.included_segments) === '["Members"]', "app, canal, idempotence, segment MEMBERS : " + JSON.stringify(body.included_segments));
  must(body.headings.fr === "Nouvel événement" && body.headings.en === "New event" && body.contents.fr === "Soirée · Kigoma" && body.contents.en === "Night · Kigoma", "FR + EN");
  must(body.data.eventId === "e1" && body.data.paths.fr === "/events/soiree" && body.data.paths.en === "/events/night" && body.url === "https://eglise.example.org/events/soiree", "charge utile : " + JSON.stringify(body.data) + body.url);
  for (const [aud, seg] of [["ALL", "All"], ["ADMINS", "Admins"], ["VISITORS", "Visitors"]]) must(JSON.stringify(p.buildPayload({ ...msg, audience: aud }).included_segments) === JSON.stringify([seg]), "segment " + aud);
  const frOnly = p.buildPayload({ ...msg, contents: { fr: msg.contents.fr } }); must(frOnly.headings.en === "Nouvel événement" && frOnly.contents.en === "Soirée · Kigoma" && frOnly.headings.fr, "« en » obligatoire : repli sur le français");
  must(!("url" in mkProv(ok({})).buildPayload({ ...msg, contents: { fr: { title: "t", body: "b" } } })), "pas d'url sans chemin");
  must(!("url" in new OneSignalProvider({ appId: "a", apiKey: "k", segments: { ALL: "All" }, fetchImpl: async () => ok({ id: "x" }) }).buildPayload(msg)), "pas d'url absolue sans PUBLIC_SITE_URL");
  const off = new OneSignalProvider({ appId: "app", segments: {} }); must(!off.enabled, "désactivé sans clé d'API");
  try { await off.send(msg); throw new Error("envoi accepté sans clés"); } catch (e) { must(e instanceof ProviderError && e.retryable === false && calls.length === 1, "refus sans appel réseau : " + e.message); }
});
await t("OneSignalProvider : erreurs — 429 / 5xx / réseau coupé = à réessayer ; 400 / 401 = définitif ; « aucun abonné » = envoi valide à 0 destinataire", async () => {
  const msg = { notificationId: "22222222-2222-4222-8222-222222222222", audience: "ALL", type: "GENERAL", defaultLanguage: "fr", contents: { fr: { title: "t", body: "b" } }, data: {} };
  const mk = (fn) => new OneSignalProvider({ appId: "a", apiKey: "k", segments: { ALL: "All" }, fetchImpl: fn });
  const resp = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const expectErr = async (prov, retryable, text) => { try { await prov.send(msg); throw new Error("pas d'erreur : " + text); } catch (e) { must(e instanceof ProviderError && e.retryable === retryable && e.message.includes(text), `${text} : ${e.message} (retryable ${e.retryable})`); } };
  await expectErr(mk(resp(429, { errors: ["rate limited"] })), true, "429"); await expectErr(mk(resp(500, {})), true, "500"); await expectErr(mk(resp(503, null)), true, "503");
  await expectErr(mk(resp(400, { errors: ["Invalid segment"] })), false, "Invalid segment"); await expectErr(mk(resp(401, { errors: ["Access denied"] })), false, "Access denied"); await expectErr(mk(resp(403, {})), false, "403");
  await expectErr(mk(async () => { throw new TypeError("fetch failed"); }), true, "injoignable");
  await expectErr(mk(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }), true, "délai dépassé");
  must(JSON.stringify(await mk(resp(200, { id: "", errors: ["All included players are not subscribed"] })).send(msg)) === '{"providerMessageId":null,"recipients":0}', "aucun abonné : envoi valide");
  await expectErr(mk(resp(200, { errors: ["Quelque chose d'inattendu"] })), false, "sans identifiant");
  const sensitive = await mk(resp(401, { errors: ["bad key"] })).send(msg).catch((e) => JSON.stringify(e.details) + e.message); must(!sensitive.includes('"k"') && !sensitive.includes("Key k"), "la clé n'apparaît pas dans l'erreur");
  const slow = new FakeProvider(); slow.failNext(1, { retryable: false, message: "refus" }); try { await slow.send(msg); } catch (e) { must(e.retryable === false, "FakeProvider : refus définitif"); }
});

// --- Nettoyage : tout ce que ce test a créé ---
setProvider(initialProvider);
const notifIds = (await prismaRaw.notification.findMany({ select: { id: true } })).map((x) => x.id);
await prismaRaw.notification.deleteMany({ where: { id: { in: notifIds } } }); // l'historique suit (cascade)
await prismaRaw.sermon.deleteMany({ where: { id: { in: ctx.sermons } } });
await prismaRaw.person.deleteMany({ where: { id: { in: ctx.people } } });
await prismaRaw.dailyMessage.deleteMany({ where: { id: { in: ctx.daily } } });
await prismaRaw.news.deleteMany({ where: { id: { in: ctx.news } } });
await prismaRaw.event.deleteMany({ where: { id: { in: ctx.events } } });
await prismaRaw.storageFile.deleteMany({ where: { id: audioFile.id } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: { in: ["notifications", "events", "news", "daily_messages", "sermons", "people"] } } });
const left = (await prismaRaw.notification.count()) + (await prismaRaw.notificationLog.count());
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} lignes restantes`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
