import "./helpers/safety.mjs";
// Test d'intégration du tableau de bord : API HTTP réelle + vraie base de données.
// La base contient d'autres données : les vérifications portent sur des ÉCARTS (avant / après création de données de test)
// et sur la cohérence avec les listes d'administration. Aucun appel à Cloudinary ni à OneSignal.
// Utilise le compte SEED_ADMIN_* (Super Admin) et un Admin créé pour l'occasion ; supprime tout ce qu'il crée.
// Lancer : npm run test:dashboard
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { signToken } = await import("../src/utils/jwt.js");
const { addDays } = await import("../src/services/dashboard/dashboard.rules.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3127);
const base = "http://localhost:3127/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 320)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const superToken = (await login.json()).data.token;
// Admin (rôle ADMIN) créé pour le test : le token suffit (le compte est relu en base à chaque requête).
const admin = await prismaRaw.admin.create({ data: { email: `dashboard-${tag}@test.local`, password: "non-utilisé", firstName: "Test", lastName: `Dashboard${tag}`, role: "ADMIN" } });
const adminToken = signToken({ id: admin.id, role: "ADMIN" });

async function api(method, path, { token = superToken, auth = true } = {}) {
  const r = await fetch(base + path, { method, headers: auth ? { authorization: "Bearer " + token } : {} });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const D = "/admin/dashboard";
const dash = async (query = "", token) => {
  const r = await api("GET", `${D}${query}`, { token });
  if (r.s !== 200) throw new Error(`GET ${D}${query} -> ${r.s} ${JSON.stringify(r.b)}`);
  return r.b.data;
};
const MIN = 60e3, H = 3600e3, DAY = 24 * H;
const at = (ms) => new Date(Date.now() + ms);
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const dateOnly = (s) => new Date(`${s}T00:00:00.000Z`);
let seq = 0;
const slug = (p) => `${p}-${tag}-${++seq}`;

// Traces de ce qui est créé (nettoyage)
const made = { event: [], news: [], dailyMessage: [], sermon: [], sermonSeries: [], person: [], galleryAlbum: [], notification: [], storageFile: [] };
const keep = (model, row) => (made[model].push(row.id), row);
const mkEvent = (o, en) => prismaRaw.event.create({ data: { startsAt: at(5 * DAY), ...o, translations: { create: [{ language: "fr", slug: slug("ev"), title: `Événement ${tag}`, description: "d", location: "Salle" }, ...(en ? [{ language: "en", slug: slug("ev"), title: en, description: "d" }] : [])] } } }).then((r) => keep("event", r));
const mkNews = (o) => prismaRaw.news.create({ data: { ...o, translations: { create: [{ language: "fr", slug: slug("nw"), title: `Actualité ${tag}`, content: "c" }] } } }).then((r) => keep("news", r));
const mkSermon = (o, en) => prismaRaw.sermon.create({ data: { date: dateOnly(day(-3)), ...o, translations: { create: [{ language: "fr", slug: slug("sm"), title: `Prédication ${tag}` }, ...(en ? [{ language: "en", slug: slug("sm"), title: en }] : [])] } } }).then((r) => keep("sermon", r));
const mkFile = (o = {}) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "gallery/items", originalFilename: "f.jpg", mimeType: "image/jpeg", bytes: 1, checksum: randomBytes(32).toString("hex"), ...o } }).then((r) => keep("storageFile", r));
const mkNotification = (o) => prismaRaw.notification.create({ data: { ...o, translations: { create: [{ language: "fr", title: `Notification ${tag}`, message: "m" }] } } }).then((r) => keep("notification", r));
const mkDaily = (date, o) => prismaRaw.dailyMessage.create({ data: { date: dateOnly(date), ...o, translations: { create: [{ language: "fr", title: `Message ${tag}`, content: "c" }] } } }).then((r) => keep("dailyMessage", r));
const alert = (data, code) => data.alerts.find((a) => a.code === code) ?? { count: 0, data: {} };

await t("sécurité : 401 sans token ; Admin et Super Admin autorisés ; Cache-Control no-store", async () => {
  must((await api("GET", D, { auth: false })).s === 401 && (await api("GET", `${D}/activity`, { auth: false })).s === 401, "401");
  const a = await api("GET", D, { token: adminToken });
  const s = await api("GET", D);
  must(a.s === 200 && s.s === 200 && a.b.success === true, `${a.s} / ${s.s}`);
  must(a.h.get("cache-control") === "no-store" && (await api("GET", `${D}/activity`)).h.get("cache-control") === "no-store", "no-store");
});

await t("validation : days (1 à 31), lang, et paramètres de l'activité -> 422", async () => {
  for (const q of ["?days=0", "?days=32", "?days=abc", "?lang=de"]) must((await api("GET", D + q)).s === 422, q);
  for (const q of ["?limit=0", "?limit=101", "?page=0", "?entity=inconnue", "?action=READ", "?adminId=pas-un-uuid", "?from=hier", "?to=2026-13-45"]) {
    must((await api("GET", `${D}/activity${q}`)).s === 422, "activity" + q);
  }
  must((await api("GET", `${D}?days=1`)).s === 200 && (await api("GET", `${D}?days=31&lang=en`)).s === 200, "bornes acceptées");
});

await t("forme : jour de l'église, fuseau, langue ; admins réservés au Super Admin ; total = somme des états", async () => {
  const s = await dash("?lang=en");
  must(/^\d{4}-\d{2}-\d{2}$/.test(s.today) && s.timeZone && s.language === "en" && s.summary.recentDays === 30, JSON.stringify([s.today, s.timeZone, s.language]));
  must(s.summary.admins && s.summary.admins.total >= s.summary.admins.active && s.summary.admins.active >= 1, "admins (Super Admin)");
  must(!("admins" in (await dash("", adminToken)).summary), "admins masqué pour un Admin");
  for (const k of ["events", "news", "dailyMessages", "sermons", "sermonSeries", "people"]) {
    const m = s.summary[k];
    must(m.total === Object.values(m.byState).reduce((a, b) => a + b, 0), `${k} : total ${m.total}`);
  }
  must(s.summary.notifications.total === Object.values(s.summary.notifications.byStatus).reduce((a, b) => a + b, 0), "notifications");
  must(typeof s.summary.notifications.provider.enabled === "boolean" && !JSON.stringify(s).match(/api_?key|secret/i), "fournisseur sans secret");
});

await t("cohérence : chaque compteur par état = total de la liste d'administration filtrée sur cet état", async () => {
  const s = await dash();
  const lists = { events: "/admin/events", news: "/admin/news", dailyMessages: "/admin/daily-messages", sermons: "/admin/sermons" };
  for (const [k, path] of Object.entries(lists)) {
    for (const [state, n] of Object.entries(s.summary[k].byState)) {
      const r = await api("GET", `${path}?state=${state}&limit=1`);
      must(r.s === 200 && r.b.meta.total === n, `${k} ${state} : tableau de bord ${n}, liste ${r.b.meta?.total}`);
    }
  }
  for (const [status, n] of Object.entries(s.summary.notifications.byStatus)) {
    const r = await api("GET", `/admin/notifications?status=${status}&limit=1`);
    must(r.s === 200 && r.b.meta.total === n, `notifications ${status} : ${n} / ${r.b.meta?.total}`);
  }
});

await t("indicateurs : écarts exacts après création (états déduits, supprimés exclus, publiés récemment)", async () => {
  const before = (await dash()).summary;
  await mkEvent({ status: "DRAFT" });
  await mkEvent({ status: "SCHEDULED", publishAt: at(3 * DAY) });
  await mkEvent({ status: "PUBLISHED", publishedAt: at(-DAY) });
  await mkEvent({ status: "SCHEDULED", publishAt: at(-MIN), startsAt: at(6 * DAY) }); // programmé échu : publié de fait
  await mkEvent({ status: "PUBLISHED", startsAt: at(-3 * DAY), endsAt: at(-3 * DAY + 2 * H), publishedAt: at(-40 * DAY) }); // terminé
  await mkEvent({ status: "CANCELLED", publishedAt: at(-2 * DAY) });
  await mkEvent({ status: "ARCHIVED" });
  await mkEvent({ status: "PUBLISHED", publishedAt: at(-DAY), deletedAt: new Date() }); // supprimé
  await mkNews({ status: "DRAFT" });
  await mkNews({ status: "PUBLISHED", publishedAt: at(-2 * DAY) });
  await mkNews({ status: "SCHEDULED", publishAt: at(2 * DAY) });
  await mkSermon({ status: "PUBLISHED", publishedAt: at(-DAY), viewCount: 7, playCount: 3, downloadCount: 2 });
  await mkSermon({ status: "PUBLISHED", viewCount: 1000, deletedAt: new Date() });
  keep("sermonSeries", await prismaRaw.sermonSeries.create({ data: { status: "DRAFT" } }));
  keep("person", await prismaRaw.person.create({ data: { firstName: "Test", lastName: tag, slug: slug("p"), status: "PUBLISHED" } }));
  const album = keep("galleryAlbum", await prismaRaw.galleryAlbum.create({ data: { date: dateOnly(day(-1)), status: "PUBLISHED" } }));
  const gone = keep("galleryAlbum", await prismaRaw.galleryAlbum.create({ data: { date: dateOnly(day(-1)), status: "PUBLISHED", deletedAt: new Date() } }));
  const f1 = await mkFile({ bytes: 1234 }), f2 = await mkFile({ resourceType: "VIDEO", bytes: 4000, mimeType: "video/mp4" }), f3 = await mkFile();
  await mkFile({ resourceType: "RAW", bytes: 999, deletedAt: new Date() });
  await prismaRaw.galleryItem.createMany({ data: [
    { albumId: album.id, storageFileId: f1.id, type: "PHOTO", position: 0 },
    { albumId: album.id, storageFileId: f2.id, type: "VIDEO", position: 1 },
    { albumId: gone.id, storageFileId: f3.id, type: "PHOTO", position: 0 },
  ] });
  await mkNotification({ status: "FAILED" });
  await mkNotification({ status: "SENT", sentAt: at(-H) });
  await mkNotification({ status: "SENT", sentAt: at(-40 * DAY) });
  const after = (await dash()).summary;

  const delta = (k, path) => path.split(".").reduce((o, p) => o[p], after[k]) - path.split(".").reduce((o, p) => o[p], before[k]);
  const ev = Object.fromEntries(Object.keys(after.events.byState).map((s) => [s, delta("events", `byState.${s}`)]));
  must(JSON.stringify(ev) === JSON.stringify({ DRAFT: 1, SCHEDULED: 1, PUBLISHED: 2, ENDED: 1, CANCELLED: 1, ARCHIVED: 1 }), "événements : " + JSON.stringify(ev));
  must(delta("events", "total") === 7 && delta("events", "publishedRecently") === 2, `événements total ${delta("events", "total")}, récents ${delta("events", "publishedRecently")}`);
  must(delta("news", "byState.DRAFT") === 1 && delta("news", "byState.PUBLISHED") === 1 && delta("news", "byState.SCHEDULED") === 1 && delta("news", "publishedRecently") === 1, "actualités");
  must(delta("sermons", "byState.PUBLISHED") === 1 && delta("sermons", "stats.views") === 7 && delta("sermons", "stats.plays") === 3 && delta("sermons", "stats.downloads") === 2, "prédications : " + JSON.stringify(after.sermons.stats));
  must(delta("sermonSeries", "byState.DRAFT") === 1 && delta("people", "byState.PUBLISHED") === 1, "séries / personnes");
  must(delta("gallery", "albums.total") === 1 && delta("gallery", "items.total") === 2 && delta("gallery", "items.photos") === 1 && delta("gallery", "items.videos") === 1, "galerie : " + JSON.stringify(after.gallery));
  must(delta("storage", "files") === 3 && delta("storage", "bytes") === 1234 + 4000 + 1 && delta("storage", "byResourceType.VIDEO.bytes") === 4000 && delta("storage", "byResourceType.RAW.files") === 0, "stockage : " + JSON.stringify(after.storage));
  must(delta("notifications", "byStatus.FAILED") === 1 && delta("notifications", "byStatus.SENT") === 2 && delta("notifications", "sentRecently") === 1, "notifications");
});

await t("prédications : top 5 par vues, publiées seulement, titre dans la langue demandée (repli sur le français)", async () => {
  const max = (await prismaRaw.sermon.aggregate({ where: { deletedAt: null }, _max: { viewCount: true } }))._max.viewCount ?? 0;
  const star = await mkSermon({ status: "PUBLISHED", publishedAt: at(-H), viewCount: max + 1000 }, `Sermon ${tag}`);
  await mkSermon({ status: "DRAFT", viewCount: max + 5000 }); // brouillon : jamais dans le top
  const fr = (await dash("?lang=fr")).summary.sermons.top;
  const en = (await dash("?lang=en")).summary.sermons.top;
  must(fr.length <= 5 && fr[0].id === star.id && fr[0].title === `Prédication ${tag}` && en[0].title === `Sermon ${tag}`, JSON.stringify(fr[0]));
  must(fr[0].views === max + 1000 && /^\d{4}-\d{2}-\d{2}$/.test(fr[0].date) && fr.every((x, i) => i === 0 || fr[i - 1].views >= x.views), "tri et champs");
});

await t("alertes : programmation en retard, notifications en échec / en retard ou fournisseur désactivé, envois bloqués ; tri par gravité", async () => {
  const before = await dash();
  await mkNews({ status: "SCHEDULED", publishAt: at(-10 * MIN) });
  await mkEvent({ status: "SCHEDULED", publishAt: at(-10 * MIN) });
  await mkEvent({ status: "SCHEDULED", publishAt: at(-2 * MIN) }); // moins de 5 min : pas encore en retard
  await mkNotification({ status: "FAILED" });
  await mkNotification({ status: "SCHEDULED", scheduledAt: at(-20 * MIN) });
  await mkFile({ status: "UPLOADING", createdAt: at(-2 * H) });
  await mkFile({ status: "UPLOADING" }); // récent : pas bloqué
  const after = await dash();
  const d = (code) => alert(after, code).count - alert(before, code).count;
  must(d("SCHEDULER_LATE") === 2 && alert(after, "SCHEDULER_LATE").data.news - (alert(before, "SCHEDULER_LATE").data.news ?? 0) === 1, "SCHEDULER_LATE : " + JSON.stringify(alert(after, "SCHEDULER_LATE")));
  must(d("NOTIFICATIONS_FAILED") === 1 && d("STORAGE_UPLOADS_STUCK") === 1, `échecs ${d("NOTIFICATIONS_FAILED")}, envois ${d("STORAGE_UPLOADS_STUCK")}`);
  if (after.summary.notifications.provider.enabled) must(d("NOTIFICATIONS_LATE") === 1 && !alert(after, "NOTIFICATIONS_PROVIDER_DISABLED").code, "retard (fournisseur actif)");
  else must(d("NOTIFICATIONS_PROVIDER_DISABLED") === 1 && !alert(after, "NOTIFICATIONS_LATE").code, "fournisseur désactivé");
  const order = ["critical", "warning", "info"];
  must(after.alerts.every((a, i) => i === 0 || order.indexOf(after.alerts[i - 1].severity) <= order.indexOf(a.severity)), "tri : " + after.alerts.map((a) => a.severity));
  must(after.alerts.every((a) => a.count > 0 && Object.keys(a).every((k) => ["code", "severity", "count", "data"].includes(k))), "forme (codes, jamais de texte)");
});

await t("messages du jour : alerte = jours non couverts de l'agenda à 7 jours ; publié couvre, brouillon ne couvre pas", async () => {
  const s0 = await dash("?days=7");
  const uncovered = s0.agenda.dailyMessages.filter((x) => !x.covered).map((x) => x.date);
  must(JSON.stringify(alert(s0, "DAILY_MESSAGES_MISSING").data.dates ?? []) === JSON.stringify(uncovered), "alerte ≠ agenda : " + JSON.stringify(uncovered));
  if (uncovered.length) must(alert(s0, "DAILY_MESSAGES_MISSING").severity === (uncovered.includes(s0.today) ? "critical" : "warning"), "gravité");
  const free = s0.agenda.dailyMessages.filter((x) => x.message === null).map((x) => x.date);
  if (free.length >= 1) {
    const m = await mkDaily(free[0], { status: "PUBLISHED", publishedAt: new Date() });
    const s1 = await dash("?days=7");
    const entry = s1.agenda.dailyMessages.find((x) => x.date === free[0]);
    must(entry.covered && entry.message.id === m.id && entry.message.state === "PUBLISHED" && entry.message.title === `Message ${tag}`, JSON.stringify(entry));
    must(!(alert(s1, "DAILY_MESSAGES_MISSING").data.dates ?? []).includes(free[0]), "date couverte retirée de l'alerte");
  }
  if (free.length >= 2) {
    await mkDaily(free[1], { status: "DRAFT" });
    const s2 = await dash("?days=7");
    must(s2.agenda.dailyMessages.find((x) => x.date === free[1]).covered === false && alert(s2, "DAILY_MESSAGES_MISSING").data.dates.includes(free[1]), "brouillon : toujours manquant");
  }
});

await t("agenda : fenêtre de N jours, événements en cours / à venir triés, publications et notifications programmées", async () => {
  const soon = await mkEvent({ status: "PUBLISHED", startsAt: at(2 * DAY), publishedAt: at(-H) }, `Event ${tag}`);
  const later = await mkEvent({ status: "PUBLISHED", startsAt: at(20 * DAY), publishedAt: at(-H) });
  const pub = await mkNews({ status: "SCHEDULED", publishAt: at(DAY) });
  const notif = await mkNotification({ status: "SCHEDULED", scheduledAt: at(H) });
  const w = await dash("?days=7&lang=en");
  const a = w.agenda;
  must(a.days === 7 && a.from === w.today && a.to === addDays(w.today, 6) && a.dailyMessages.length === 7, JSON.stringify([a.from, a.to]));
  must(a.dailyMessages.every((x, i) => x.date === addDays(w.today, i)), "dates consécutives");
  must(a.events.every((e, i) => i === 0 || new Date(a.events[i - 1].startsAt) <= new Date(e.startsAt)), "événements triés");
  must(a.events.every((e) => ["PUBLISHED", "SCHEDULED"].includes(e.state) && new Date(e.startsAt) <= new Date(Date.parse(a.to) + DAY + 14 * H)), "états et fenêtre"); // borne : fin du dernier jour, quel que soit le fuseau
  must(!a.events.some((e) => e.id === later.id), "événement hors fenêtre exclu");
  const full = (list, limit) => list.length >= limit;
  if (!full(a.events, 20)) must(a.events.find((e) => e.id === soon.id)?.title === `Event ${tag}`, "événement à venir présent, titre en anglais");
  must(a.publications.every((p, i) => i === 0 || new Date(a.publications[i - 1].publishAt) <= new Date(p.publishAt)), "publications triées");
  must(a.publications.every((p) => ["events", "news", "dailyMessages", "sermons"].includes(p.module) && new Date(p.publishAt) > started), "publications futures");
  if (!full(a.publications, 50)) must(a.publications.some((p) => p.module === "news" && p.id === pub.id), "publication programmée présente");
  if (!full(a.notifications, 20)) must(a.notifications.some((n) => n.id === notif.id && n.type === "GENERAL" && n.audience === "ALL" && n.title === `Notification ${tag}`), "notification planifiée présente");
  const long = await dash("?days=31");
  must(long.agenda.dailyMessages.length === 31 && long.agenda.to === addDays(long.today, 30), "31 jours");
  if (!full(long.agenda.events, 20)) must(long.agenda.events.some((e) => e.id === later.id), "événement à +20 j présent sur 31 jours");
  const one = await dash("?days=1");
  must(one.agenda.dailyMessages.length === 1 && one.agenda.from === one.agenda.to, "1 jour");
});

await t("activité : filtres, pagination, ordre, sans IP ni navigateur ; Admin sans l'entité admins (403 si demandée)", async () => {
  const mkLog = (action, entity, minutesAgo) => prismaRaw.auditLog.create({ data: { adminId: admin.id, action, entity, entityId: admin.id, ipAddress: "10.0.0.1", userAgent: "test", changes: { field: ["x"] }, createdAt: at(-minutesAgo * MIN) } });
  await mkLog("LOGIN", "admins", 3);
  await mkLog("CREATE", "events", 2);
  await mkLog("UPDATE", "news", 1);
  const all = await api("GET", `${D}/activity?adminId=${admin.id}`);
  must(all.s === 200 && all.b.meta.total === 3 && all.b.data.map((x) => x.action).join() === "UPDATE,CREATE,LOGIN", "Super Admin : " + JSON.stringify(all.b.meta));
  const item = all.b.data[0];
  must(item.admin.id === admin.id && item.admin.lastName === `Dashboard${tag}` && item.entity === "news" && item.changes.field[0] === "x", JSON.stringify(item));
  must(all.b.data.every((x) => !("ipAddress" in x) && !("userAgent" in x) && !("email" in x.admin)), "aucun champ sensible");
  const asAdmin = await api("GET", `${D}/activity?adminId=${admin.id}`, { token: adminToken });
  must(asAdmin.s === 200 && asAdmin.b.meta.total === 2 && !asAdmin.b.data.some((x) => x.entity === "admins"), "Admin : lignes admins masquées");
  must((await api("GET", `${D}/activity?entity=admins`, { token: adminToken })).s === 403, "Admin : entity=admins -> 403");
  must((await api("GET", `${D}/activity?entity=admins&adminId=${admin.id}`)).b.meta.total === 1, "Super Admin : entity=admins");
  must((await api("GET", `${D}/activity?adminId=${admin.id}&action=CREATE`)).b.data[0].entity === "events", "filtre action");
  const p2 = await api("GET", `${D}/activity?adminId=${admin.id}&limit=2&page=2`);
  must(p2.b.data.length === 1 && p2.b.meta.totalPages === 2 && p2.b.data[0].action === "LOGIN", "pagination");
  const range = await api("GET", `${D}/activity?adminId=${admin.id}&from=${encodeURIComponent(at(-150 * 1000).toISOString())}`);
  must(range.b.meta.total === 2, "filtre from : " + range.b.meta.total);
  const auto = await api("GET", `${D}/activity?entity=events&limit=100`);
  must(auto.s === 200 && auto.b.data.every((x) => x.entity === "events" && (x.admin === null || x.admin.id)), "actions automatiques : admin null");
});

await t("lecture seule : le tableau de bord n'écrit rien (ni contenu, ni journal d'audit)", async () => {
  const counts = () => Promise.all([prismaRaw.auditLog.count(), prismaRaw.notification.count(), prismaRaw.event.count(), prismaRaw.storageFile.count()]);
  const before = await counts();
  await dash("?days=31");
  await api("GET", `${D}/activity`);
  await dash("", adminToken);
  must(JSON.stringify(await counts()) === JSON.stringify(before), "écritures détectées");
});

// --- Nettoyage ---
await prismaRaw.galleryItem.deleteMany({ where: { albumId: { in: made.galleryAlbum } } });
for (const model of ["notification", "event", "news", "dailyMessage", "sermon", "sermonSeries", "person", "galleryAlbum", "storageFile"]) {
  await prismaRaw[model].deleteMany({ where: { id: { in: made[model] } } });
}
await prismaRaw.auditLog.deleteMany({ where: { adminId: admin.id } });
await prismaRaw.admin.delete({ where: { id: admin.id } });
const left = await Promise.all([
  prismaRaw.event.count({ where: { translations: { some: { title: { contains: tag } } } } }),
  prismaRaw.notification.count({ where: { translations: { some: { title: { contains: tag } } } } }),
  prismaRaw.admin.count({ where: { lastName: `Dashboard${tag}` } }),
]);
res.push(left.every((n) => n === 0) ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left.join("/")} restants`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
