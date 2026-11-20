// Test d'intégration du module Événements : API HTTP réelle + vraie base de données.
// Aucun appel à Cloudinary (les images de couverture sont de simples lignes storage_files READY).
// Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.   Lancer : npm run test:events
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { domainEvents } = await import("../src/utils/domainEvents.js");
const { publishDueEvents } = await import("../src/services/content/scheduler.js");
const { computeState } = await import("../src/services/events/event.state.js");
const { slugify } = await import("../src/utils/slug.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3118);
const base = "http://localhost:3118/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 240)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const A = "/admin/events";
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const H = 3600e3, D = 24 * H;
const made = [];
const mk = async (over = {}, trans) => {
  const r = await api("POST", A, { startsAt: iso(10 * D), translations: { fr: { title: `Conférence ${tag} ${made.length}`, description: "Description française" }, ...trans }, ...over });
  if (r.s !== 201) throw new Error("création " + r.s + JSON.stringify(r.b));
  made.push(r.b.data.id);
  return r.b.data;
};

// --- Données de support ---
const mkFile = (over) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "events/covers", originalFilename: "c.jpg", mimeType: "image/jpeg", bytes: 1, width: 800, height: 450, checksum: randomBytes(32).toString("hex"), ...over } });
const imgFile = await mkFile({});
const pdfFile = await mkFile({ resourceType: "RAW", mimeType: "application/pdf", folder: "events/documents" });
const upFile = await mkFile({ status: "UPLOADING" });

await t("sécurité : 401 sans token (admin), public sans authentification", async () => {
  must((await api("GET", A, null, { auth: false })).s === 401, "admin list");
  must((await api("POST", A, {}, { auth: false })).s === 401, "admin create");
  must((await api("GET", "/events", null, { auth: false })).s === 200, "public list");
});
await t("validation : fr manquant, langue inconnue, dates, URL, slug, titre court -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", A, body)).s === 422, label);
  const ok = { startsAt: iso(D), translations: { fr: { title: "Titre valide", description: "d" } } };
  await bad({ startsAt: iso(D), translations: { en: { title: "Only EN", description: "d" } } }, "sans fr");
  await bad({ ...ok, translations: { ...ok.translations, de: { title: "Titel", description: "d" } } }, "langue de");
  await bad({ ...ok, endsAt: iso(-D) }, "fin avant début");
  await bad({ ...ok, registrationUrl: "ftp://x" }, "url");
  await bad({ ...ok, translations: { fr: { ...ok.translations.fr, slug: "Pas Valide" } } }, "slug");
  await bad({ ...ok, translations: { fr: { title: "ab", description: "d" } } }, "titre court");
  await bad({ ...ok, startsAt: "demain" }, "date");
  await bad({ ...ok, translations: { ...ok.translations, en: { title: "Sans description" } } }, "en incomplet");
});
let ev;
await t("création : DRAFT, slug sans accents ni symboles, champs par défaut", async () => {
  ev = await mk({ endsAt: iso(10 * D + 2 * H) }, { fr: { title: `Soirée de Louange & Adoration ! ${tag}`, description: "Une soirée.", location: "147 Kigoma" } });
  must(ev.status === "DRAFT" && ev.state === "DRAFT", ev.status);
  must(ev.translations.fr.slug === slugify(`Soirée de Louange & Adoration ! ${tag}`) && /^soiree-de-louange-adoration-/.test(ev.translations.fr.slug), ev.translations.fr.slug);
  must(ev.isFeatured === false && ev.registrationRequired === false && ev.notifyOnPublish === false && ev.registrationUrl === null, "défauts");
  must(ev.createdById, "createdById");
});
await t("slug en doublon : suffixe -2 automatique ; slug explicite en conflit -> 409", async () => {
  const dup = await mk({}, { fr: { title: `Soirée de Louange & Adoration ! ${tag}`, description: "bis" } });
  must(dup.translations.fr.slug === ev.translations.fr.slug + "-2", dup.translations.fr.slug);
  const r = await api("POST", A, { startsAt: iso(D), translations: { fr: { title: "Autre titre", description: "d", slug: ev.translations.fr.slug } } });
  must(r.s === 409, "attendu 409, reçu " + r.s);
});
await t("image de couverture : image prête OK ; PDF, envoi en cours, inconnue -> 422", async () => {
  const withCover = await mk({ coverImageId: imgFile.id });
  must(withCover.coverImage?.url.startsWith("https://res.cloudinary.com/") && withCover.coverImage.thumbnailUrl, JSON.stringify(withCover.coverImage));
  for (const id of [pdfFile.id, upFile.id, "00000000-0000-4000-8000-000000000000"]) {
    const r = await api("POST", A, { startsAt: iso(D), coverImageId: id, translations: { fr: { title: "Avec image invalide", description: "d" } } });
    must(r.s === 422, id + " -> " + r.s);
  }
});
await t("modification : slug conservé si le titre change ; traduction EN ajoutée puis supprimée ; FR non supprimable", async () => {
  let r = await api("PATCH", `${A}/${ev.id}`, { translations: { fr: { title: `Nouveau titre ${tag}` }, en: { title: `Praise Night ${tag}`, description: "A night." } } });
  must(r.s === 200, r.s + JSON.stringify(r.b));
  const d = r.b.data;
  must(d.translations.fr.slug === ev.translations.fr.slug && d.translations.fr.title === `Nouveau titre ${tag}`, "slug/titre fr");
  must(d.translations.en.slug === slugify(`Praise Night ${tag}`), "slug en");
  r = await api("PATCH", `${A}/${ev.id}`, { translations: { en: null } });
  must(r.s === 200 && !r.b.data.translations.en, "suppression en");
  r = await api("PATCH", `${A}/${ev.id}`, { translations: { fr: null } });
  must(r.s === 422, "suppression fr " + r.s);
  r = await api("PATCH", `${A}/${ev.id}`, { endsAt: iso(-D) });
  must(r.s === 422, "fin avant début " + r.s);
  r = await api("PATCH", `${A}/${ev.id}`, { translations: { en: { title: `Praise Night ${tag}`, description: "A night." } } });
  must(r.s === 200 && r.b.data.translations.en, "recréation en");
});
await t("inscription et vedette : champs enregistrés et modifiables", async () => {
  const r = await api("PATCH", `${A}/${ev.id}`, { isFeatured: true, registrationRequired: true, registrationUrl: "https://forms.example.org/evc", notifyOnPublish: true });
  must(r.s === 200 && r.b.data.isFeatured && r.b.data.registrationRequired && r.b.data.registrationUrl === "https://forms.example.org/evc" && r.b.data.notifyOnPublish, JSON.stringify(r.b));
  ev = r.b.data;
});
await t("brouillon : invisible du public (liste et détail)", async () => {
  const list = await api("GET", "/events?when=all&limit=100", null, { auth: false });
  must(!list.b.data.some((e) => e.id === ev.id), "visible dans la liste");
  must((await api("GET", `/events/${ev.translations.fr.slug}`, null, { auth: false })).s === 404, "détail visible");
});
const published = [];
domainEvents.on("event.published", (p) => published.push(p));
const cancelled = [];
domainEvents.on("event.cancelled", (p) => cancelled.push(p));

await t("publication : PUBLISHED, visible, détail par slug, en-tête de cache, champs internes masqués", async () => {
  const r = await api("POST", `${A}/${ev.id}/publish`);
  must(r.s === 200 && r.b.data.status === "PUBLISHED" && r.b.data.state === "PUBLISHED" && r.b.data.publishedAt, JSON.stringify(r.b));
  const list = await api("GET", "/events?limit=100", null, { auth: false });
  const item = list.b.data.find((e) => e.id === ev.id);
  must(item, "absent de la liste");
  const detail = await api("GET", `/events/${ev.translations.fr.slug}`, null, { auth: false });
  must(detail.s === 200 && detail.h.get("cache-control") === "public, max-age=60", detail.s + " " + detail.h.get("cache-control"));
  for (const k of ["createdById", "status", "publishAt", "notifyOnPublish", "createdAt", "deletedAt"]) must(!(k in detail.b.data), "champ interne exposé : " + k);
  must(detail.b.data.registrationRequired === true && detail.b.data.registrationUrl, "inscription");
  must(published.some((p) => p.eventId === ev.id && p.notifyOnPublish === true && p.reason === "manual"), "événement métier 'event.published' non émis");
});
await t("langues : ?lang=en et Accept-Language ; repli sur le français ; alternates", async () => {
  const en = await api("GET", `/events/${ev.translations.en.slug}?lang=en`, null, { auth: false });
  must(en.s === 200 && en.b.data.language === "en" && en.b.data.title === `Praise Night ${tag}`, JSON.stringify(en.b));
  const viaHeader = await api("GET", "/events?limit=100", null, { auth: false, headers: { "accept-language": "en-US,en;q=0.9" } });
  must(viaHeader.b.data.find((e) => e.id === ev.id)?.language === "en", "Accept-Language ignoré");
  const noEn = await mk({}, {}); await api("POST", `${A}/${noEn.id}/publish`);
  const fb = await api("GET", "/events?lang=en&limit=100", null, { auth: false });
  must(fb.b.data.find((e) => e.id === noEn.id)?.language === "fr", "repli fr");
  must(en.b.data.alternates.fr === ev.translations.fr.slug && en.b.data.alternates.en, "alternates");
  must((await api("GET", `/events/${ev.translations.fr.slug}?lang=en`, null, { auth: false })).s === 404, "slug fr dans la langue en");
  must((await api("GET", "/events?lang=de", null, { auth: false })).s === 422, "lang=de");
});
await t("état « terminé » : déduit des dates, filtres when=upcoming / past", async () => {
  const past = await mk({ startsAt: iso(-10 * D), endsAt: iso(-10 * D + 2 * H) });
  await api("POST", `${A}/${past.id}/publish`);
  const g = await api("GET", `${A}/${past.id}`);
  must(g.b.data.status === "PUBLISHED" && g.b.data.state === "ENDED", g.b.data.state);
  const up = await api("GET", "/events?when=upcoming&limit=100", null, { auth: false });
  const pa = await api("GET", "/events?when=past&limit=100", null, { auth: false });
  must(!up.b.data.some((e) => e.id === past.id) && pa.b.data.some((e) => e.id === past.id), "filtres when");
  must(pa.b.data.every((e) => e.state === "ENDED") && up.b.data.every((e) => e.state !== "ENDED"), "états incohérents");
  // Sans fin : terminé à 23 h 59 (Kinshasa, UTC+1) du jour de début. Début 10 h UTC = 11 h locale.
  const noEnd = { status: "PUBLISHED", startsAt: new Date("2031-06-10T10:00:00Z"), endsAt: null };
  const at = (iso) => computeState(noEnd, new Date(iso));
  must(at("2031-06-10T10:30:00Z") === "PUBLISHED", "pendant l'événement");
  must(at("2031-06-10T22:30:00Z") === "PUBLISHED", "23 h 30 locale : encore publié (l'ancienne règle de 3 h l'aurait terminé)");
  must(at("2031-06-10T22:59:59Z") === "PUBLISHED", "23 h 59 locale");
  must(at("2031-06-10T23:00:00Z") === "ENDED", "minuit local : terminé");
  must(computeState({ ...noEnd, endsAt: new Date("2031-06-12T10:00:00Z") }, new Date("2031-06-11T10:00:00Z")) === "PUBLISHED", "fin explicite respectée");
  const dbNoEnd = await mk({ startsAt: iso(-2 * D) }); // pas de fin, commencé il y a 2 jours
  await api("POST", `${A}/${dbNoEnd.id}/publish`);
  const pastList = await api("GET", "/events?when=past&limit=100", null, { auth: false });
  must(pastList.b.data.some((e) => e.id === dbNoEnd.id && e.state === "ENDED"), "sans fin, commencé il y a 2 j : doit être terminé");
  const adminEnded = await api("GET", `${A}?state=ENDED&q=${tag}&limit=100`);
  must(adminEnded.b.data.some((e) => e.id === past.id) && adminEnded.b.data.every((e) => e.state === "ENDED"), "filtre admin ENDED");
});
await t("annulation : visible avec l'état CANCELLED ; impossible depuis un brouillon ; republication", async () => {
  const draft = await mk({});
  must((await api("POST", `${A}/${draft.id}/cancel`)).s === 409, "annuler un brouillon");
  const r = await api("POST", `${A}/${ev.id}/cancel`, { reason: "Intempéries" });
  must(r.s === 200 && r.b.data.state === "CANCELLED" && r.b.data.cancelledAt, JSON.stringify(r.b));
  const pub = await api("GET", `/events/${ev.translations.fr.slug}`, null, { auth: false });
  must(pub.s === 200 && pub.b.data.state === "CANCELLED", "annulé non visible");
  must(cancelled.some((p) => p.eventId === ev.id), "événement métier 'event.cancelled' non émis");
  const re = await api("POST", `${A}/${ev.id}/publish`);
  must(re.s === 200 && re.b.data.state === "PUBLISHED" && re.b.data.cancelledAt === null, "republication");
});
await t("programmation : validations (passé, < 1 min, après la fin) puis succès", async () => {
  const s = await mk({ endsAt: iso(10 * D + 2 * H) });
  must((await api("POST", `${A}/${s.id}/schedule`, {})).s === 422, "sans date");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(-H) })).s === 422, "passé");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(20 * 1000) })).s === 422, "< 1 min");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(11 * D) })).s === 422, "après la fin");
  const ok = await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  must(ok.s === 200 && ok.b.data.status === "SCHEDULED" && ok.b.data.state === "SCHEDULED" && ok.b.data.publishAt, JSON.stringify(ok.b));
  must((await api("GET", `/events/${s.translations.fr.slug}`, null, { auth: false })).s === 404, "visible avant l'heure");
  const re = await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(3 * D) });
  must(re.s === 200, "reprogrammation");
});
await t("publication programmée : visibilité à l'heure dite, puis bascule atomique par la tâche (une seule fois)", async () => {
  const s = await mk({}, { fr: { title: `Programmé ${tag}`, description: "d" } });
  await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  await prismaRaw.event.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000), notifyOnPublish: true } }); // l'heure est « venue »
  const lazy = await api("GET", `/events/${s.translations.fr.slug}`, null, { auth: false });
  must(lazy.s === 200 && lazy.b.data.state === "PUBLISHED", "non visible à l'heure dite : " + lazy.s);
  must((await prismaRaw.event.findUnique({ where: { id: s.id } })).status === "SCHEDULED", "déjà basculé ?");
  const n1 = await publishDueEvents();
  const row = await prismaRaw.event.findUnique({ where: { id: s.id } });
  must(n1 >= 1 && row.status === "PUBLISHED" && row.publishedAt, `tâche : ${n1} ${row.status}`);
  must(published.some((p) => p.eventId === s.id && p.reason === "scheduled" && p.notifyOnPublish === true), "événement métier non émis");
  const audit = await prismaRaw.auditLog.findFirst({ where: { action: "STATUS_CHANGE", entityId: s.id }, orderBy: { createdAt: "desc" } });
  must(audit?.changes?.reason === "scheduled" && audit.adminId === null, "audit système");
  const n2 = await publishDueEvents();
  must(!published.filter((p) => p.eventId === s.id && p.reason === "scheduled").slice(1).length, "émis deux fois");
  void n2;
});
await t("transitions : dépublier, archiver, désarchiver ; actions invalides -> 409 ; archivé non modifiable", async () => {
  const e = await mk({});
  must((await api("POST", `${A}/${e.id}/unpublish`)).s === 409, "dépublier un brouillon");
  must((await api("POST", `${A}/${e.id}/unarchive`)).s === 409, "désarchiver un brouillon");
  await api("POST", `${A}/${e.id}/publish`);
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier deux fois");
  const un = await api("POST", `${A}/${e.id}/unpublish`);
  must(un.b.data.status === "DRAFT", "dépublier");
  must((await api("GET", `/events/${e.translations.fr.slug}`, null, { auth: false })).s === 404, "visible après dépublication");
  const ar = await api("POST", `${A}/${e.id}/archive`);
  must(ar.b.data.state === "ARCHIVED", "archiver");
  must((await api("PATCH", `${A}/${e.id}`, { isFeatured: true })).s === 409, "modifier un archivé");
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier un archivé");
  must((await api("POST", `${A}/${e.id}/unarchive`)).b.data.status === "DRAFT", "désarchiver");
  must((await api("POST", `${A}/00000000-0000-4000-8000-000000000000/publish`)).s === 404, "inconnu");
});
await t("deux publications simultanées : une seule réussit", async () => {
  const e = await mk({});
  const rs = await Promise.all([api("POST", `${A}/${e.id}/publish`), api("POST", `${A}/${e.id}/publish`)]);
  const codes = rs.map((r) => r.s).sort();
  must(codes[0] === 200 && codes[1] === 409, "codes " + codes);
});
await t("suppression logique : refusée si publié ; brouillon -> corbeille -> restauration ; programmé restauré en brouillon", async () => {
  const pubd = await mk({}); await api("POST", `${A}/${pubd.id}/publish`);
  must((await api("DELETE", `${A}/${pubd.id}`)).s === 409, "supprimer un publié");
  const d = await mk({});
  must((await api("DELETE", `${A}/${d.id}`)).s === 200, "supprimer");
  must((await api("GET", `${A}/${d.id}`)).s === 200, "lecture admin d'un supprimé");
  must(!(await api("GET", `${A}?q=${tag}&limit=100`)).b.data.some((e) => e.id === d.id), "visible dans la liste");
  must((await api("GET", `${A}?deleted=true&limit=100`)).b.data.some((e) => e.id === d.id), "absent de la corbeille");
  must((await api("PATCH", `${A}/${d.id}`, { isFeatured: true })).s === 404, "modifier un supprimé");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 200, "restaurer");
  const s = await mk({}); await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  await api("DELETE", `${A}/${s.id}`);
  const rs = await api("POST", `${A}/${s.id}/restore`);
  must(rs.b.data.status === "DRAFT" && rs.b.data.publishAt === null, "programmé non remis en brouillon");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 404, "restaurer un actif");
});
await t("recherche, vedettes, filtres de dates et pagination (meta, tri)", async () => {
  const k = `Rech${randomBytes(3).toString("hex")}`;
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const e = await mk({ startsAt: iso((20 + i) * D), isFeatured: i === 0, registrationRequired: i === 1 }, { fr: { title: `${k} événement ${i}`, description: i === 2 ? `contient ${k}-desc` : "x", location: "Kinshasa" } });
    await api("POST", `${A}/${e.id}/publish`); ids.push(e.id);
  }
  const p1 = await api("GET", `/events?q=${k}&limit=2&page=1`, null, { auth: false });
  const p3 = await api("GET", `/events?q=${k}&limit=2&page=3`, null, { auth: false });
  must(p1.b.meta.total === 5 && p1.b.meta.totalPages === 3 && p1.b.data.length === 2 && p3.b.data.length === 1, JSON.stringify(p1.b.meta));
  const startsOrder = p1.b.data.map((e) => +new Date(e.startsAt)); must(startsOrder[0] < startsOrder[1], "tri à venir croissant");
  must((await api("GET", `/events?q=${k}&featured=true`, null, { auth: false })).b.data.length === 1, "vedette publique");
  must((await api("GET", `${A}?q=${k}&registrationRequired=true`)).b.data.length === 1, "inscription admin");
  const range = await api("GET", `${A}?q=${k}&from=${iso(21 * D)}&to=${iso(23 * D)}&sort=startsAt&order=asc`);
  must(range.b.data.length === 2 && +new Date(range.b.data[0].startsAt) < +new Date(range.b.data[1].startsAt), "plage de dates " + range.b.data.length);
  must((await api("GET", `${A}?limit=1000`)).s === 422 && (await api("GET", `${A}?state=FOO`)).s === 422 && (await api("GET", `${A}?sort=title`)).s === 422, "paramètres invalides");
  const inj = await api("GET", `${A}?q=${encodeURIComponent("'; DROP TABLE events;--")}`);
  must(inj.s === 200 && inj.b.data.length === 0, "injection");
});
await t("type, capacité, couleur, icône : valeurs par défaut, validation, places restantes", async () => {
  const e = await mk({});
  must(e.type === "OTHER" && e.capacity === null && e.registeredCount === 0 && e.color === null && e.icon === null && e.spotsLeft === null && e.isFull === false, "défauts " + JSON.stringify([e.type, e.capacity, e.spotsLeft]));
  const bad = async (body, label) => must((await api("PATCH", `${A}/${e.id}`, body)).s === 422, label);
  await bad({ type: "PARTY" }, "type inconnu");
  await bad({ capacity: 0 }, "capacité 0"); await bad({ capacity: -5 }, "capacité négative"); await bad({ capacity: 1.5 }, "capacité décimale");
  await bad({ color: "red" }, "couleur nommée"); await bad({ color: "#12345" }, "couleur courte"); await bad({ icon: "Church Icon" }, "icône invalide");
  for (const type of ["SERVICE", "CONFERENCE", "SEMINAR", "RETREAT", "YOUTH", "PRAYER", "EVANGELISM", "OTHER"]) {
    must((await api("PATCH", `${A}/${e.id}`, { type })).b.data.type === type, type);
  }
  const ok = await api("PATCH", `${A}/${e.id}`, { type: "YOUTH", capacity: 50, color: "#C0FFEE", icon: "music-note", registeredCount: 999 });
  must(ok.s === 200 && ok.b.data.capacity === 50 && ok.b.data.color === "#c0ffee" && ok.b.data.icon === "music-note", JSON.stringify(ok.b));
  must(ok.b.data.registeredCount === 0 && ok.b.data.spotsLeft === 50 && ok.b.data.isFull === false, "registeredCount ne doit pas être modifiable par l'API");
  // Effacer des valeurs : « null » doit être pris en compte (et pas ignoré en silence)
  const withAll = await api("PATCH", `${A}/${e.id}`, { endsAt: iso(30 * D), coverImageId: imgFile.id, registrationUrl: "https://forms.example.org/x" });
  must(withAll.s === 200 && withAll.b.data.endsAt && withAll.b.data.coverImage && withAll.b.data.registrationUrl, "renseigner : " + withAll.s);
  const cleared = await api("PATCH", `${A}/${e.id}`, { endsAt: null, coverImageId: null, registrationUrl: null, color: null, icon: null });
  const cd = cleared.b.data;
  must(cleared.s === 200 && cd.endsAt === null && cd.coverImage === null && cd.registrationUrl === null && cd.color === null && cd.icon === null, "effacer fin, image, URL, couleur, icône : " + JSON.stringify([cleared.s, cd?.endsAt, cd?.color, cd?.icon]));
  await api("PATCH", `${A}/${e.id}`, { color: "#C0FFEE", icon: "music-note" });
  const full = await prismaRaw.event.update({ where: { id: e.id }, data: { registeredCount: 50 } });
  must(full.registeredCount === 50, "préparation");
  const g = await api("GET", `${A}/${e.id}`); must(g.b.data.spotsLeft === 0 && g.b.data.isFull === true, "complet");
  must((await api("PATCH", `${A}/${e.id}`, { capacity: 40 })).s === 422, "capacité < inscrits");
  must((await api("PATCH", `${A}/${e.id}`, { capacity: null })).b.data.spotsLeft === null, "illimitée");
  const unlimited = await api("PATCH", `${A}/${e.id}`, { capacity: 50 }); must(unlimited.s === 200, "50 = inscrits");
  await prismaRaw.event.update({ where: { id: e.id }, data: { registeredCount: 3 } });
  await api("POST", `${A}/${e.id}/publish`);
  const pub = (await api("GET", `/events/${e.translations.fr.slug}`, null, { auth: false })).b.data;
  must(pub.type === "YOUTH" && pub.color === "#c0ffee" && pub.icon === "music-note" && pub.capacity === 50 && pub.spotsLeft === 47 && pub.isFull === false && !("registeredCount" in pub), "DTO public " + JSON.stringify(pub));
});
await t("filtre par type : administration et lecture publique", async () => {
  const k = `Typ${randomBytes(3).toString("hex")}`;
  const a = await mk({ type: "PRAYER" }, { fr: { title: `${k} prière`, description: "d" } });
  const b = await mk({ type: "SEMINAR" }, { fr: { title: `${k} séminaire`, description: "d" } });
  for (const x of [a, b]) await api("POST", `${A}/${x.id}/publish`);
  must((await api("GET", `${A}?q=${k}&type=PRAYER`)).b.data.map((e) => e.id).join() === a.id, "admin");
  must((await api("GET", `/events?q=${k}&type=SEMINAR`, null, { auth: false })).b.data.map((e) => e.id).join() === b.id, "public");
  must((await api("GET", `/events?type=NOPE`, null, { auth: false })).s === 422, "type invalide");
});
await t("identifiant réservé « calendar » : refusé en slug explicite, évité à la génération", async () => {
  const r = await api("POST", A, { startsAt: iso(D), translations: { fr: { title: "Titre quelconque", description: "d", slug: "calendar" } } });
  must(r.s === 422, "slug calendar accepté : " + r.s);
  const g = await mk({}, { fr: { title: "Calendar", description: "d" } });
  must(g.translations.fr.slug === "calendar-2", "slug généré " + g.translations.fr.slug);
});
await t("calendrier : mois local, chevauchement, états visibles, filtres, langue, validations", async () => {
  const k = `Cal${randomBytes(3).toString("hex")}`;
  const E = (title, extra, trans) => mk(extra, { fr: { title: `${k} ${title}`, description: "d", ...trans?.fr }, ...trans });
  const march = await E("mars", { startsAt: "2031-03-10T10:00:00.000Z", type: "SERVICE", color: "#112233", icon: "church" }, { en: { title: `${k} march`, description: "d" } });
  const overlap = await E("à cheval", { startsAt: "2031-02-27T10:00:00.000Z", endsAt: "2031-03-02T10:00:00.000Z" });
  const april = await E("avril", { startsAt: "2031-04-05T10:00:00.000Z" });
  const draft = await E("brouillon", { startsAt: "2031-03-12T10:00:00.000Z" });
  const cancelled = await E("annulé", { startsAt: "2031-03-14T10:00:00.000Z", type: "PRAYER" });
  const feb = await E("fin février (23 h 30 locale)", { startsAt: "2031-02-28T22:30:00.000Z" }); // 28/02 23 h 30 à Kinshasa : fait partie de février
  const mar1 = await E("1er mars 00 h 30 locale", { startsAt: "2031-02-28T23:30:00.000Z" }); // 01/03 00 h 30 à Kinshasa : fait partie de mars
  for (const x of [march, overlap, april, cancelled, feb, mar1]) await api("POST", `${A}/${x.id}/publish`);
  await api("POST", `${A}/${cancelled.id}/cancel`);
  const cal = async (qs, opts) => api("GET", `/events/calendar?${qs}`, null, { auth: false, ...opts });
  const mine = (r) => r.b.data.items.filter((e) => e.title.includes(k) || e.title.toLowerCase().includes(k.toLowerCase()));
  const m = await cal("month=2031-03");
  must(m.s === 200 && m.h.get("cache-control") === "public, max-age=60", m.s + JSON.stringify(m.b).slice(0, 200));
  const ids = mine(m).map((e) => e.id);
  must(ids.includes(march.id) && ids.includes(overlap.id) && ids.includes(cancelled.id) && ids.includes(mar1.id), "présents attendus : " + ids.length);
  must(!ids.includes(april.id) && !ids.includes(draft.id) && !ids.includes(feb.id), "absents attendus (avril, brouillon, 28/02 local)");
  must(m.b.data.from === "2031-02-28T23:00:00.000Z" && m.b.data.to === "2031-03-31T23:00:00.000Z", `bornes locales ${m.b.data.from} ${m.b.data.to}`);
  const item = mine(m).find((e) => e.id === march.id);
  must(item.type === "SERVICE" && item.color === "#112233" && item.icon === "church" && item.end === "2031-03-10T22:59:59.999Z" && item.endsAt === null, "entrée " + JSON.stringify(item));
  must(!("description" in item) && !("coverImage" in item), "entrée trop lourde");
  must(mine(m).find((e) => e.id === cancelled.id).state === "CANCELLED", "annulé visible avec son état");
  must(mine(m).map((e) => +new Date(e.startsAt)).every((v, i, a) => i === 0 || a[i - 1] <= v), "tri par début");
  must(mine(await cal("month=2031-03&type=PRAYER")).map((e) => e.id).join() === cancelled.id, "filtre type");
  must(mine(await cal("month=2031-03&lang=en")).find((e) => e.id === march.id).title === `${k} march`, "langue en");
  const range = await cal(`from=${encodeURIComponent("2031-03-09T00:00:00Z")}&to=${encodeURIComponent("2031-03-11T00:00:00Z")}`);
  must(mine(range).some((e) => e.id === march.id) && !mine(range).some((e) => e.id === overlap.id), "plage from/to : mars (10/03) oui, l'événement du 27/02 au 02/03 non");
  const wide = await cal(`from=${encodeURIComponent("2031-03-01T00:00:00Z")}&to=${encodeURIComponent("2031-03-03T00:00:00Z")}`);
  must(mine(wide).some((e) => e.id === overlap.id) && !mine(wide).some((e) => e.id === march.id), "plage qui touche la fin de l'événement à cheval");
  must(m.b.data.truncated === false && m.b.data.count === m.b.data.items.length, "méta");
  for (const [qs, label] of [["", "sans période"], ["month=2031-13", "mois invalide"], ["month=2031-03&from=2031-03-01T00:00:00Z&to=2031-03-05T00:00:00Z", "mois et plage"], ["from=2031-03-05T00:00:00Z", "from seul"], ["from=2031-03-05T00:00:00Z&to=2031-03-01T00:00:00Z", "to avant from"], ["from=2031-01-01T00:00:00Z&to=2033-01-01T00:00:00Z", "plage > 366 j"], ["month=2031-03&lang=de", "langue"]]) {
    must((await cal(qs)).s === 422, label);
  }
  must((await api("GET", "/events/calendar?month=2031-03", null, { auth: false })).s === 200, "route calendar interceptée par :slug");
});
await t("audit : création, modification (champs sans contenu), changement de statut, suppression, restauration", async () => {
  const log = (action) => prismaRaw.auditLog.findMany({ where: { entity: "events", action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map(log));
  must(c.length && u.length && st.length && d.length && r.length, `${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must(c[0].adminId && c[0].ipAddress, "adminId / ip");
  const upd = u.find((l) => l.changes?.translations?.fr);
  must(upd && Array.isArray(upd.changes.translations.fr.updated) && !JSON.stringify(upd.changes).includes("Une soirée"), "le contenu des textes ne doit pas figurer dans l'audit");
  must(st.some((l) => l.changes.action === "cancel" && l.changes.reason === "Intempéries") && st.every((l) => l.changes.from && l.changes.to), "changements de statut");
});
await t("base : contraintes CHECK (dates, programmation sans date, URL, slug)", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  await bad(`insert into events ("startsAt","endsAt","updatedAt") values (now(), now() - interval '1 day', now())`, "fin < début");
  await bad(`insert into events ("status","startsAt","updatedAt") values ('SCHEDULED', now(), now())`, "SCHEDULED sans publishAt");
  await bad(`insert into events ("startsAt","registrationUrl","updatedAt") values (now(), 'javascript:alert(1)', now())`, "url non http");
  await bad(`insert into event_translations ("eventId","language","slug","title","description") values ('${made[0]}','en','Pas Valide','t','d')`, "slug invalide");
});

// --- Nettoyage ---
await prismaRaw.event.deleteMany({ where: { id: { in: made } } });
await prismaRaw.storageFile.deleteMany({ where: { id: { in: [imgFile.id, pdfFile.id, upFile.id] } } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "events" } });
const left = await prismaRaw.event.count({ where: { translations: { some: { title: { contains: tag } } } } });
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} événements restants`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
