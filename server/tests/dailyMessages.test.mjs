import "./helpers/safety.mjs";
// Test d'intégration du module Messages du jour : API HTTP réelle + vraie base de données.
// Aucun appel à Cloudinary. Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.
// ATTENTION : la base ne doit contenir aucun autre message du jour (le repli « dernier message publié »
// les verrait). Lancer : npm run test:daily-messages
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { domainEvents } = await import("../src/utils/domainEvents.js");
const { publishDueDailyMessages } = await import("../src/services/content/scheduler.js");
const { todayString } = await import("../src/services/dailyMessages/dailyMessage.state.js");
const { estimateReadingTime } = await import("../src/utils/readingTime.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3121);
const base = "http://localhost:3121/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 260)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const preexisting = await prismaRaw.dailyMessage.count();
if (preexisting) { console.log(`ARRÊT : ${preexisting} message(s) déjà en base ; ce test exige une table vide.`); process.exit(1); }

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const A = "/admin/daily-messages";
const P = "/daily-messages";
const TODAY = todayString(new Date());
const day = (n, from = TODAY) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const H = 3600e3, D = 24 * H;
const made = [];
const mk = async (date, over = {}, fr = {}, extra = {}) => {
  const r = await api("POST", A, { date, translations: { fr: { title: `Message ${tag} ${date}`, content: "Texte du message du jour.", ...fr }, ...extra }, ...over });
  if (r.s !== 201) throw new Error("création " + date + " : " + r.s + JSON.stringify(r.b));
  made.push(r.b.data.id);
  return r.b.data;
};
const mkFile = (over) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "daily-messages", originalFilename: "c.jpg", mimeType: "image/jpeg", bytes: 1, width: 800, height: 450, checksum: randomBytes(32).toString("hex"), ...over } });
const imgFile = await mkFile({});
const pdfFile = await mkFile({ resourceType: "RAW", mimeType: "application/pdf" });
const upFile = await mkFile({ status: "UPLOADING" });
const published = [];
domainEvents.on("daily-message.published", (p) => published.push(p));

await t("sécurité : 401 sans token (admin) ; sans message, /today -> 404 (pas d'erreur serveur)", async () => {
  must((await api("GET", A, null, { auth: false })).s === 401 && (await api("POST", A, {}, { auth: false })).s === 401, "admin");
  const r = await api("GET", `${P}/today`, null, { auth: false });
  must(r.s === 404 && r.b.success === false, "today sans message : " + r.s);
  must((await api("GET", P, null, { auth: false })).s === 200, "liste publique vide");
});
await t("validation : date, textes, notification, booléens -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", A, body)).s === 422, label);
  const fr = { title: "Titre valide", content: "contenu" };
  await bad({ translations: { fr } }, "sans date");
  await bad({ date: "2031-02-30", translations: { fr } }, "30 février");
  await bad({ date: "demain", translations: { fr } }, "date texte");
  await bad({ date: "2031-3-5", translations: { fr } }, "date sans zéros");
  await bad({ date: day(1), translations: { en: fr } }, "sans fr");
  await bad({ date: day(1), translations: { fr, de: fr } }, "langue de");
  await bad({ date: day(1), translations: { fr: { ...fr, title: "ab" } } }, "titre court");
  await bad({ date: day(1), translations: { fr: { ...fr, content: "" } } }, "contenu vide");
  await bad({ date: day(1), translations: { fr: { ...fr, verseReference: "x".repeat(101) } } }, "référence trop longue");
  await bad({ date: day(1), translations: { fr: { ...fr, theme: "x".repeat(61) } } }, "thème trop long");
  await bad({ date: day(1), translations: { fr: { ...fr, notificationTitle: "x".repeat(81) } } }, "titre de notification");
  await bad({ date: day(1), translations: { fr: { ...fr, notificationBody: "x".repeat(241) } } }, "corps de notification");
  await bad({ date: day(1), sendNotification: "oui", translations: { fr } }, "booléen");
  await bad({ date: day(1), translations: { fr, en: { title: "No content" } } }, "en incomplet");
});
let m1;
await t("création : DRAFT, tous les champs, temps de lecture calculé (jamais saisi)", async () => {
  m1 = await mk(day(40), { sendNotification: true }, {
    title: `Rester ferme ${tag}`, content: "mot ".repeat(280), verseReference: "Jean 3:16", verseText: "verset ".repeat(140), theme: "Espérance",
    notificationTitle: "Message du jour", notificationBody: "Une parole pour aujourd'hui", estimatedReadingTime: 99,
  });
  const f = m1.translations.fr;
  must(m1.status === "DRAFT" && m1.state === "DRAFT" && m1.date === day(40) && m1.phase === "UPCOMING" && m1.sendNotification === true && m1.publishedAt === null, JSON.stringify([m1.status, m1.date, m1.phase]));
  must(f.verseReference === "Jean 3:16" && f.theme === "Espérance" && f.notificationTitle === "Message du jour" && f.notificationBody === "Une parole pour aujourd'hui", "champs");
  must(f.estimatedReadingTime === estimateReadingTime("mot ".repeat(280), "verset ".repeat(140)) && f.estimatedReadingTime === 3, "temps de lecture : " + f.estimatedReadingTime + " (attendu 3 pour 420 mots, et 99 ignoré)");
  const short = await mk(day(41), {}, { content: "court" });
  must(short.translations.fr.estimatedReadingTime === 1, "minimum 1 minute");
});
await t("une seule date active : doublon -> 409 ; après suppression logique la date est réutilisable", async () => {
  const r = await api("POST", A, { date: day(40), translations: { fr: { title: "Doublon de date", content: "c" } } });
  must(r.s === 409 && r.b.errors?.[0]?.field === "date", r.s + JSON.stringify(r.b));
  const tmp = await mk(day(60));
  must((await api("DELETE", `${A}/${tmp.id}`)).s === 200, "supprimer");
  const again = await mk(day(60));
  must(again.id !== tmp.id, "recréation");
  must((await api("DELETE", `${A}/${again.id}`)).s === 200, "nettoyage");
});
await t("modification : temps de lecture recalculé selon contenu et verset ; titre seul = inchangé ; EN ajoutée ; FR non supprimable", async () => {
  let r = await api("PATCH", `${A}/${m1.id}`, { translations: { fr: { title: `Titre modifié ${tag}` } } });
  must(r.s === 200 && r.b.data.translations.fr.estimatedReadingTime === 3, "titre seul : " + r.b.data?.translations?.fr?.estimatedReadingTime);
  r = await api("PATCH", `${A}/${m1.id}`, { translations: { fr: { verseText: null } } });
  must(r.b.data.translations.fr.verseText === null && r.b.data.translations.fr.estimatedReadingTime === 2, "verset effacé : " + JSON.stringify([r.b.data.translations.fr.verseText, r.b.data.translations.fr.estimatedReadingTime]));
  r = await api("PATCH", `${A}/${m1.id}`, { translations: { fr: { content: "mot ".repeat(900) } } });
  must(r.b.data.translations.fr.estimatedReadingTime === 5, "900 mots -> 5 min : " + r.b.data.translations.fr.estimatedReadingTime);
  r = await api("PATCH", `${A}/${m1.id}`, { translations: { en: { title: `Stand firm ${tag}`, content: "Short English text.", theme: "Hope" } } });
  must(r.s === 200 && r.b.data.translations.en.estimatedReadingTime === 1 && r.b.data.translations.en.theme === "Hope", JSON.stringify(r.b).slice(0, 200));
  r = await api("PATCH", `${A}/${m1.id}`, { translations: { en: null } }); must(!r.b.data.translations.en, "suppression en");
  must((await api("PATCH", `${A}/${m1.id}`, { translations: { fr: null } })).s === 422, "suppression fr");
  r = await api("PATCH", `${A}/${m1.id}`, { translations: { en: { title: `Stand firm ${tag}`, content: "Short English text.", theme: "Hope" } } });
  m1 = r.b.data;
  must((await api("PATCH", `${A}/${m1.id}`, { date: day(41) })).s === 409, "date déjà prise");
  r = await api("PATCH", `${A}/${m1.id}`, { date: day(42), sendNotification: false });
  must(r.s === 200 && r.b.data.date === day(42) && r.b.data.sendNotification === false, "changement de date " + r.s);
  m1 = r.b.data;
});
await t("image : prête OK, effaçable (null) ; PDF, envoi en cours, inconnue -> 422", async () => {
  let r = await api("PATCH", `${A}/${m1.id}`, { imageId: imgFile.id });
  must(r.s === 200 && r.b.data.image?.url.startsWith("https://res.cloudinary.com/") && r.b.data.image.thumbnailUrl, "ajouter");
  r = await api("PATCH", `${A}/${m1.id}`, { imageId: null }); must(r.s === 200 && r.b.data.image === null, "effacer (null) : " + r.s);
  for (const id of [pdfFile.id, upFile.id, "00000000-0000-4000-8000-000000000000"]) must((await api("PATCH", `${A}/${m1.id}`, { imageId: id })).s === 422, id);
});
await t("brouillon invisible ; message à date FUTURE publié : toujours invisible (liste, /today, par date)", async () => {
  must((await api("GET", `${P}/${m1.date}`, null, { auth: false })).s === 404, "brouillon par date");
  const r = await api("POST", `${A}/${m1.id}/publish`);
  must(r.s === 200 && r.b.data.status === "PUBLISHED" && r.b.data.phase === "UPCOMING", JSON.stringify(r.b).slice(0, 200));
  must((await api("GET", `${P}/${m1.date}`, null, { auth: false })).s === 404, "date future visible !");
  must(!(await api("GET", `${P}?limit=100`, null, { auth: false })).b.data.some((x) => x.id === m1.id), "visible dans l'archive");
  must((await api("GET", `${P}/today`, null, { auth: false })).s === 404, "/today a renvoyé un message futur");
  must(published.some((p) => p.dailyMessageId === m1.id && p.sendNotification === false && p.date === m1.date && p.reason === "manual"), "événement métier (avec la date)");
  await api("POST", `${A}/${m1.id}/unpublish`);
});
let d1, d3, dToday, dFuture;
await t("REPLI : sans message pour aujourd'hui, /today renvoie le dernier message publié (isFallback) ; brouillons, archivés et futurs ignorés", async () => {
  d1 = await mk(day(-1), {}, { title: `Hier ${tag}`, verseReference: "Psaume 23:1", theme: "Paix" });
  d3 = await mk(day(-3), {}, { title: `Il y a trois jours ${tag}` });
  const arch = await mk(day(-2), {}, { title: `Archivé ${tag}` });
  dToday = await mk(TODAY, {}, { title: `Aujourd'hui ${tag}` });
  dFuture = await mk(day(1), {}, { title: `Demain ${tag}` });
  for (const x of [d1, d3, arch, dFuture]) await api("POST", `${A}/${x.id}/publish`);
  await api("POST", `${A}/${arch.id}/archive`);
  const r = await api("GET", `${P}/today`, null, { auth: false });
  const d = r.b.data;
  must(r.s === 200 && d.id === d1.id && d.isFallback === true && d.date === day(-1) && d.requestedDate === TODAY, JSON.stringify(d).slice(0, 300));
  must(d.content && d.verseReference === "Psaume 23:1" && "verseText" in d && d.estimatedReadingTime >= 1 && d.theme === "Paix", "contenu complet");
  must(r.h.get("cache-control") === "public, max-age=60", "cache");
});
await t("message du jour présent : isFallback = false ; dépublié -> retour au repli ; programmé échu -> visible", async () => {
  let r = await api("POST", `${A}/${dToday.id}/publish`);
  must(r.s === 200, "publier");
  let g = (await api("GET", `${P}/today`, null, { auth: false })).b.data;
  must(g.id === dToday.id && g.isFallback === false && g.date === TODAY && g.requestedDate === TODAY, JSON.stringify(g).slice(0, 200));
  await api("POST", `${A}/${dToday.id}/unpublish`);
  g = (await api("GET", `${P}/today`, null, { auth: false })).b.data;
  must(g.id === d1.id && g.isFallback === true, "retour au repli");
  await api("POST", `${A}/${dToday.id}/schedule`, { publishAt: iso(2 * H) });
  must((await api("GET", `${P}/today`, null, { auth: false })).b.data.isFallback === true, "programmé non échu : repli");
  await prismaRaw.dailyMessage.update({ where: { id: dToday.id }, data: { publishAt: new Date(Date.now() - 5000) } }); // l'heure est venue
  g = (await api("GET", `${P}/today`, null, { auth: false })).b.data;
  must(g.id === dToday.id && g.isFallback === false, "programmé échu et date atteinte : visible sans attendre la tâche");
});
await t("par date : passé publié OK ; futur, inconnu, brouillon -> 404 ; date invalide -> 422 ; /today non capturé par :date", async () => {
  must((await api("GET", `${P}/${day(-3)}`, null, { auth: false })).b.data.id === d3.id, "passé");
  must((await api("GET", `${P}/${day(-3)}`, null, { auth: false })).b.data.isFallback === false, "pas de repli par date");
  must((await api("GET", `${P}/${day(1)}`, null, { auth: false })).s === 404, "demain (publié mais futur)");
  must((await api("GET", `${P}/${day(-300)}`, null, { auth: false })).s === 404, "inconnu");
  must((await api("GET", `${P}/2031-02-30`, null, { auth: false })).s === 422 && (await api("GET", `${P}/abc`, null, { auth: false })).s === 422, "invalide");
  must((await api("GET", `${P}/today`, null, { auth: false })).s === 200, "/today");
});
await t("langues : ?lang=en et Accept-Language, repli sur le français, availableLanguages", async () => {
  await api("PATCH", `${A}/${d1.id}`, { translations: { en: { title: `Yesterday ${tag}`, content: "English text.", theme: "Peace" } } });
  const en = await api("GET", `${P}/${day(-1)}?lang=en`, null, { auth: false });
  must(en.b.data.language === "en" && en.b.data.title === `Yesterday ${tag}` && en.b.data.theme === "Peace" && en.b.data.availableLanguages.length === 2, JSON.stringify(en.b).slice(0, 250));
  const hdr = await api("GET", `${P}/today`, null, { auth: false, headers: { "accept-language": "en-US,en;q=0.9" } });
  must(hdr.b.data.language === "fr", "message du jour sans traduction en : repli fr");
  must((await api("GET", `${P}/${day(-3)}?lang=en`, null, { auth: false })).b.data.language === "fr", "repli fr");
  must((await api("GET", `${P}/${day(-1)}`, null, { auth: false, headers: { "accept-language": "en-GB" } })).b.data.language === "en", "Accept-Language");
  must((await api("GET", `${P}/today?lang=de`, null, { auth: false })).s === 422, "lang=de");
});
await t("lecture publique : aucun champ interne (statut, notification, auteur, programmation)", async () => {
  const d = (await api("GET", `${P}/${day(-1)}`, null, { auth: false })).b.data;
  for (const k of ["status", "state", "sendNotification", "notificationTitle", "notificationBody", "createdById", "publishAt", "createdAt", "deletedAt", "translations"]) must(!(k in d), "champ interne : " + k);
  const l = (await api("GET", `${P}?limit=100`, null, { auth: false })).b.data[0];
  for (const k of ["sendNotification", "notificationTitle", "createdById", "content", "verseText"]) must(!(k in l), "liste, champ : " + k);
  must(l.excerpt && l.estimatedReadingTime >= 1, "extrait et temps de lecture");
});
await t("archive publique : affichables seulement, récents d'abord, pagination, recherche, thème, dates", async () => {
  const all = await api("GET", `${P}?limit=100`, null, { auth: false });
  const ids = all.b.data.map((x) => x.id);
  must(ids.includes(dToday.id) && ids.includes(d1.id) && ids.includes(d3.id) && !ids.includes(dFuture.id) && !ids.includes(m1.id), "contenu de l'archive");
  const dates = all.b.data.map((x) => x.date); must(dates.join() === [...dates].sort().reverse().join(), "tri date décroissante");
  const p = await api("GET", `${P}?limit=1&page=2`, null, { auth: false }); must(p.b.meta.total === all.b.meta.total && p.b.meta.limit === 1 && p.b.data.length === 1 && p.b.meta.totalPages === all.b.meta.total, JSON.stringify(p.b.meta));
  must((await api("GET", `${P}?q=psaume`, null, { auth: false })).b.data.map((x) => x.id).join() === d1.id, "recherche dans la référence du verset");
  must((await api("GET", `${P}?theme=paix`, null, { auth: false })).b.data.map((x) => x.id).join() === d1.id, "thème insensible à la casse");
  must((await api("GET", `${P}?from=${day(-1)}&to=${day(-1)}`, null, { auth: false })).b.data.map((x) => x.id).join() === d1.id, "plage de dates");
  must((await api("GET", `${P}?from=nope`, null, { auth: false })).s === 422 && (await api("GET", `${P}?limit=1000`, null, { auth: false })).s === 422, "paramètres invalides");
  must((await api("GET", `${P}?q=${encodeURIComponent("'; DROP TABLE daily_messages;--")}`, null, { auth: false })).b.data.length === 0, "injection");
});
await t("programmation : validations ; après le jour du message -> 422 ; succès ; futur échu mais date non atteinte -> invisible", async () => {
  const s = await mk(day(5), {}, { title: `Programmé ${tag}` });
  must((await api("POST", `${A}/${s.id}/schedule`, {})).s === 422, "sans date");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(-H) })).s === 422, "passé");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(20000) })).s === 422, "< 1 min");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(9 * D) })).s === 422, "après le jour du message");
  const ok = await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  must(ok.s === 200 && ok.b.data.state === "SCHEDULED" && ok.b.data.publishAt, JSON.stringify(ok.b).slice(0, 200));
  await prismaRaw.dailyMessage.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000) } });
  must((await api("GET", `${P}/${day(5)}`, null, { auth: false })).s === 404, "échu mais date future : doit rester invisible");
  await api("POST", `${A}/${s.id}/unpublish`);
});
await t("publication programmée : bascule atomique par la tâche, audit système, événement (sendNotification + date), une seule fois", async () => {
  const s = await mk(day(2), { sendNotification: true }, { title: `Tâche ${tag}` });
  await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * H) });
  await prismaRaw.dailyMessage.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000) } });
  const n = await publishDueDailyMessages();
  const row = await prismaRaw.dailyMessage.findUnique({ where: { id: s.id } });
  must(n >= 1 && row.status === "PUBLISHED" && row.publishedAt, `tâche : ${n} ${row.status}`);
  const ev = published.find((p) => p.dailyMessageId === s.id && p.reason === "scheduled");
  must(ev && ev.sendNotification === true && ev.date === day(2), "événement : " + JSON.stringify(ev));
  const audit = await prismaRaw.auditLog.findFirst({ where: { action: "STATUS_CHANGE", entity: "daily_messages", entityId: s.id }, orderBy: { createdAt: "desc" } });
  must(audit?.changes?.reason === "scheduled" && audit.adminId === null, "audit système");
  await publishDueDailyMessages();
  must(published.filter((p) => p.dailyMessageId === s.id && p.reason === "scheduled").length === 1, "émis deux fois");
});
await t("transitions : invalides -> 409, archivé non modifiable, publication simultanée, 404", async () => {
  const e = await mk(day(70));
  must((await api("POST", `${A}/${e.id}/unpublish`)).s === 409 && (await api("POST", `${A}/${e.id}/unarchive`)).s === 409, "depuis brouillon");
  await api("POST", `${A}/${e.id}/publish`);
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "deux fois");
  must((await api("POST", `${A}/${e.id}/archive`)).b.data.state === "ARCHIVED", "archiver");
  must((await api("PATCH", `${A}/${e.id}`, { sendNotification: true })).s === 409, "modifier un archivé");
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier un archivé");
  must((await api("POST", `${A}/${e.id}/unarchive`)).b.data.status === "DRAFT", "désarchiver");
  const c = await mk(day(71));
  const codes = (await Promise.all([api("POST", `${A}/${c.id}/publish`), api("POST", `${A}/${c.id}/publish`)])).map((r) => r.s).sort();
  must(codes[0] === 200 && codes[1] === 409, "simultané " + codes);
  must((await api("POST", `${A}/00000000-0000-4000-8000-000000000000/publish`)).s === 404, "inconnu");
});
await t("suppression logique : refusée si publié ; corbeille ; restauration ; date reprise -> 409 ; programmé restauré en brouillon", async () => {
  const p = await mk(day(80)); await api("POST", `${A}/${p.id}/publish`);
  must((await api("DELETE", `${A}/${p.id}`)).s === 409, "supprimer un publié");
  const d = await mk(day(81));
  must((await api("DELETE", `${A}/${d.id}`)).s === 200, "supprimer");
  must((await api("GET", `${A}?deleted=true&limit=100`)).b.data.some((x) => x.id === d.id), "corbeille");
  must((await api("PATCH", `${A}/${d.id}`, { sendNotification: true })).s === 404, "modifier un supprimé");
  const taken = await mk(day(81)); // la date est libre : un autre message la prend
  must((await api("POST", `${A}/${d.id}/restore`)).s === 409, "restauration alors que la date est reprise");
  await api("DELETE", `${A}/${taken.id}`);
  must((await api("POST", `${A}/${d.id}/restore`)).s === 200, "restauration");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 404, "restaurer un actif");
  const s = await mk(day(82)); await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) }); await api("DELETE", `${A}/${s.id}`);
  const r = await api("POST", `${A}/${s.id}/restore`); must(r.b.data.status === "DRAFT" && r.b.data.publishAt === null, "programmé");
});
await t("administration : filtres (état, thème, dates, recherche), tri par date, pagination ; paramètres invalides", async () => {
  const lst = (qs) => api("GET", `${A}?${qs}&limit=100`);
  const ids = async (qs) => (await lst(qs)).b.data.map((x) => x.id);
  must((await ids(`q=${tag}&state=ARCHIVED`)).length >= 1 && (await ids("state=ARCHIVED")).every(Boolean), "état");
  must((await ids(`theme=Paix`)).join() === d1.id && (await ids(`q=psaume`)).join() === d1.id, "thème / recherche");
  must((await ids(`from=${day(-3)}&to=${day(-1)}&sort=date&order=asc`))[0] === d3.id, "tri date croissante et plage");
  const desc = (await lst(`q=${tag}&sort=date&order=desc`)).b.data.map((x) => x.date); must(desc.join() === [...desc].sort().reverse().join(), "tri décroissant");
  const pg = await api("GET", `${A}?q=${tag}&limit=2&page=2`); must(pg.b.meta.page === 2 && pg.b.meta.limit === 2 && pg.b.meta.totalPages === Math.ceil(pg.b.meta.total / 2), "pagination");
  for (const qs of ["limit=1000", "state=FOO", "sort=title", "from=x", "theme="]) must((await api("GET", `${A}?${qs}`)).s === 422, qs);
});
await t("audit : création, modification (noms de champs, jamais les textes), statut, suppression, restauration", async () => {
  const log = (action) => prismaRaw.auditLog.findMany({ where: { entity: "daily_messages", action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map(log));
  must(c.length && u.length && st.length && d.length && r.length, `${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must(c[0].adminId && c[0].ipAddress, "adminId / ip");
  const dump = JSON.stringify([c, u, st, d, r]);
  must(!dump.includes("Texte du message du jour") && !dump.includes("Une parole pour aujourd") && !dump.includes("Jean 3:16"), "des textes figurent dans l'audit");
  must(u.some((l) => l.changes?.fields?.date) && u.some((l) => l.changes?.translations?.fr?.updated), "détails des modifications");
});
await t("base : contraintes (date active unique, programmé sans date, temps de lecture < 1, statut invalide)", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|duplicate key|unique|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  await bad(`insert into daily_messages ("date","updatedAt") values ('${day(-1)}'::date, now())`, "date active en double");
  await bad(`insert into daily_messages ("date","status","updatedAt") values ('${day(500)}'::date, 'SCHEDULED', now())`, "SCHEDULED sans publishAt");
  await bad(`insert into daily_messages ("date","status","updatedAt") values ('${day(501)}'::date, 'CANCELLED', now())`, "statut CANCELLED");
  await bad(`insert into daily_message_translations ("dailyMessageId","language","title","content","estimatedReadingTime") values ('${made[0]}','en','t','c',0)`, "temps de lecture 0");
});

// --- Nettoyage ---
await prismaRaw.dailyMessage.deleteMany({ where: { id: { in: made } } });
await prismaRaw.dailyMessage.deleteMany({}); // la table était vide au départ (vérifié en tête de test)
await prismaRaw.storageFile.deleteMany({ where: { id: { in: [imgFile.id, pdfFile.id, upFile.id] } } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "daily_messages" } });
const left = await prismaRaw.dailyMessage.count();
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} messages restants`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
