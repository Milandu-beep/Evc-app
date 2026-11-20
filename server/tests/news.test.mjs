// Test d'intégration du module Actualités : API HTTP réelle + vraie base de données.
// Aucun appel à Cloudinary. Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.
// Lancer : npm run test:news
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { domainEvents } = await import("../src/utils/domainEvents.js");
const { publishDueNews } = await import("../src/services/content/scheduler.js");
const { excerptOf } = await import("../src/services/content/dto.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3119);
const base = "http://localhost:3119/api";
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
const A = "/admin/news";
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const H = 3600e3, D = 24 * H;
const made = [];
const mk = async (over = {}, trans) => {
  const r = await api("POST", A, { translations: { fr: { title: `Actualité ${tag} ${made.length}`, content: "Contenu français de l'actualité." }, ...trans }, ...over });
  if (r.s !== 201) throw new Error("création " + r.s + JSON.stringify(r.b));
  made.push(r.b.data.id);
  return r.b.data;
};
const mkFile = (over) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "news/covers", originalFilename: "c.jpg", mimeType: "image/jpeg", bytes: 1, width: 800, height: 450, checksum: randomBytes(32).toString("hex"), ...over } });
const imgFile = await mkFile({});
const pdfFile = await mkFile({ resourceType: "RAW", mimeType: "application/pdf" });
const upFile = await mkFile({ status: "UPLOADING" });

await t("sécurité : 401 sans token (admin) ; lecture publique sans authentification", async () => {
  must((await api("GET", A, null, { auth: false })).s === 401 && (await api("POST", A, {}, { auth: false })).s === 401, "admin");
  must((await api("GET", "/news", null, { auth: false })).s === 200, "public");
});
await t("validation : fr manquant, langue inconnue, textes hors limites, slug, en incomplet -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", A, body)).s === 422, label);
  const fr = { title: "Titre valide", content: "contenu" };
  await bad({ translations: { en: { title: "Only EN", content: "c" } } }, "sans fr");
  await bad({ translations: { fr, de: { title: "Titel", content: "c" } } }, "langue de");
  await bad({ translations: { fr: { ...fr, title: "ab" } } }, "titre court");
  await bad({ translations: { fr: { ...fr, content: "" } } }, "contenu vide");
  await bad({ translations: { fr: { ...fr, excerpt: "x".repeat(501) } } }, "extrait trop long");
  await bad({ translations: { fr: { ...fr, slug: "Pas Valide" } } }, "slug");
  await bad({ translations: { fr, en: { title: "No content" } } }, "en incomplet");
  await bad({ translations: { fr }, isFeatured: "oui" }, "booléen");
});
let n1;
await t("création : DRAFT, slug sans accents, défauts", async () => {
  n1 = await mk({}, { fr: { title: `Nouvelle église à Kinshasa ! ${tag}`, content: "Un texte assez long pour l'actualité." } });
  must(n1.status === "DRAFT" && n1.state === "DRAFT" && n1.isFeatured === false && n1.notifyOnPublish === false && n1.publishedAt === null, JSON.stringify([n1.status, n1.isFeatured]));
  must(/^nouvelle-eglise-a-kinshasa-/.test(n1.translations.fr.slug), n1.translations.fr.slug);
});
await t("slug en doublon : -2 ; explicite en conflit -> 409", async () => {
  const dup = await mk({}, { fr: { title: `Nouvelle église à Kinshasa ! ${tag}`, content: "bis" } });
  must(dup.translations.fr.slug === n1.translations.fr.slug + "-2", dup.translations.fr.slug);
  must((await api("POST", A, { translations: { fr: { title: "Autre titre", content: "c", slug: n1.translations.fr.slug } } })).s === 409, "409");
});
await t("image de couverture : prête OK ; PDF, envoi en cours, inconnue -> 422", async () => {
  const c = await mk({ coverImageId: imgFile.id });
  must(c.coverImage?.url.startsWith("https://res.cloudinary.com/") && c.coverImage.thumbnailUrl, "couverture");
  for (const id of [pdfFile.id, upFile.id, "00000000-0000-4000-8000-000000000000"]) {
    must((await api("POST", A, { coverImageId: id, translations: { fr: { title: "Avec image", content: "c" } } })).s === 422, id);
  }
});
await t("modification : slug conservé ; EN ajoutée puis supprimée ; FR non supprimable ; archivée non modifiable", async () => {
  let r = await api("PATCH", `${A}/${n1.id}`, { translations: { fr: { title: `Titre modifié ${tag}`, excerpt: "Résumé." }, en: { title: `News title ${tag}`, content: "English content." } }, isFeatured: true, notifyOnPublish: true });
  must(r.s === 200 && r.b.data.translations.fr.slug === n1.translations.fr.slug && r.b.data.translations.fr.excerpt === "Résumé." && r.b.data.isFeatured, JSON.stringify(r.b).slice(0, 300));
  must(r.b.data.translations.en.slug === `news-title-${tag}`, "slug en");
  r = await api("PATCH", `${A}/${n1.id}`, { translations: { en: null } }); must(!r.b.data.translations.en, "suppression en");
  must((await api("PATCH", `${A}/${n1.id}`, { translations: { fr: null } })).s === 422, "suppression fr");
  r = await api("PATCH", `${A}/${n1.id}`, { translations: { en: { title: `News title ${tag}`, content: "English content." } } }); must(r.b.data.translations.en, "recréation en");
  n1 = r.b.data; // état à jour (avec l'anglais) pour les tests suivants
  r = await api("PATCH", `${A}/${n1.id}`, { coverImageId: imgFile.id }); must(r.s === 200 && r.b.data.coverImage, "ajouter la couverture");
  r = await api("PATCH", `${A}/${n1.id}`, { coverImageId: null }); must(r.s === 200 && r.b.data.coverImage === null, "effacer la couverture (null) : " + r.s);
  const e = await mk({}); await api("POST", `${A}/${e.id}/archive`);
  must((await api("PATCH", `${A}/${e.id}`, { isFeatured: true })).s === 409, "modifier une archivée");
});
const published = [];
domainEvents.on("news.published", (p) => published.push(p));
await t("brouillon invisible ; publication : visible, extrait sans contenu en liste, contenu en détail, cache, champs internes masqués", async () => {
  must(!(await api("GET", "/news?limit=100", null, { auth: false })).b.data.some((n) => n.id === n1.id), "brouillon visible dans la liste");
  must((await api("GET", `/news/${n1.translations.fr.slug}`, null, { auth: false })).s === 404, "brouillon visible en détail");
  const r = await api("POST", `${A}/${n1.id}/publish`);
  must(r.s === 200 && r.b.data.status === "PUBLISHED" && r.b.data.publishedAt, JSON.stringify(r.b).slice(0, 200));
  const item = (await api("GET", "/news?limit=100", null, { auth: false })).b.data.find((n) => n.id === n1.id);
  must(item && item.excerpt === "Résumé." && !("content" in item), "liste " + JSON.stringify(item));
  const d = await api("GET", `/news/${n1.translations.fr.slug}`, null, { auth: false });
  must(d.s === 200 && d.b.data.content && d.h.get("cache-control") === "public, max-age=60", "détail");
  for (const k of ["status", "createdById", "publishAt", "notifyOnPublish", "createdAt", "deletedAt"]) must(!(k in d.b.data), "champ interne : " + k);
  must(published.some((p) => p.newsId === n1.id && p.notifyOnPublish === true && p.reason === "manual"), "événement métier");
});
await t("extrait automatique : début du contenu coupé à un mot, jamais plus de 200 caractères", async () => {
  const long = "mot ".repeat(200);
  const a = await mk({}, { fr: { title: `Long texte ${tag}`, content: long } });
  await api("POST", `${A}/${a.id}/publish`);
  const item = (await api("GET", "/news?limit=100", null, { auth: false })).b.data.find((n) => n.id === a.id);
  must(item.excerpt.length <= 201 && item.excerpt.endsWith("…") && !item.excerpt.includes("  "), item.excerpt.length + " " + item.excerpt.slice(-10));
  must(excerptOf(null, "court") === "court" && excerptOf("fourni", "x".repeat(500)) === "fourni", "excerptOf");
});
await t("langues : ?lang=en, Accept-Language, repli sur le français, alternates", async () => {
  const en = await api("GET", `/news/${n1.translations.en.slug}?lang=en`, null, { auth: false });
  must(en.s === 200 && en.b.data.language === "en" && en.b.data.title === `News title ${tag}`, JSON.stringify(en.b).slice(0, 200));
  const hdr = await api("GET", "/news?limit=100", null, { auth: false, headers: { "accept-language": "en-GB,en;q=0.8" } });
  must(hdr.b.data.find((n) => n.id === n1.id)?.language === "en", "Accept-Language");
  const fr = await mk({}, {}); await api("POST", `${A}/${fr.id}/publish`);
  must((await api("GET", "/news?lang=en&limit=100", null, { auth: false })).b.data.find((n) => n.id === fr.id)?.language === "fr", "repli");
  must(en.b.data.alternates.fr === n1.translations.fr.slug, "alternates");
  must((await api("GET", `/news/${n1.translations.fr.slug}?lang=en`, null, { auth: false })).s === 404, "slug fr dans la langue en");
  must((await api("GET", "/news?lang=de", null, { auth: false })).s === 422, "lang=de");
});
await t("programmation : validations puis succès ; invisible avant l'heure", async () => {
  const s = await mk({});
  must((await api("POST", `${A}/${s.id}/schedule`, {})).s === 422, "sans date");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(-H) })).s === 422, "passé");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(20000) })).s === 422, "< 1 min");
  const ok = await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  must(ok.s === 200 && ok.b.data.state === "SCHEDULED" && ok.b.data.publishAt, JSON.stringify(ok.b).slice(0, 200));
  must((await api("GET", `/news/${s.translations.fr.slug}`, null, { auth: false })).s === 404, "visible avant l'heure");
  must((await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(3 * D) })).s === 200, "reprogrammation");
});
await t("publication programmée : visible à l'heure dite, en tête de liste, puis bascule atomique (une seule fois)", async () => {
  const s = await mk({}, { fr: { title: `Programmée ${tag}`, content: "Contenu programmé." } });
  await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) });
  await prismaRaw.news.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000), notifyOnPublish: true } });
  const lazy = await api("GET", `/news/${s.translations.fr.slug}`, null, { auth: false });
  must(lazy.s === 200, "non visible à l'heure dite : " + lazy.s);
  const list = await api("GET", "/news?limit=100", null, { auth: false });
  must(list.b.data[0].id === s.id, "pas en tête de liste");
  must((await prismaRaw.news.findUnique({ where: { id: s.id } })).status === "SCHEDULED", "déjà basculée ?");
  const n = await publishDueNews();
  const row = await prismaRaw.news.findUnique({ where: { id: s.id } });
  must(n >= 1 && row.status === "PUBLISHED" && row.publishedAt, `tâche : ${n} ${row.status}`);
  must(published.some((p) => p.newsId === s.id && p.reason === "scheduled" && p.notifyOnPublish === true), "événement métier");
  const audit = await prismaRaw.auditLog.findFirst({ where: { action: "STATUS_CHANGE", entity: "news", entityId: s.id }, orderBy: { createdAt: "desc" } });
  must(audit?.changes?.reason === "scheduled" && audit.adminId === null, "audit système");
  await publishDueNews();
  must(published.filter((p) => p.newsId === s.id && p.reason === "scheduled").length === 1, "émis deux fois");
});
await t("transitions : dépublier, archiver, désarchiver ; actions invalides -> 409 ; publication simultanée", async () => {
  const e = await mk({});
  must((await api("POST", `${A}/${e.id}/unpublish`)).s === 409 && (await api("POST", `${A}/${e.id}/unarchive`)).s === 409, "invalides depuis brouillon");
  must((await api("POST", `${A}/${e.id}/cancel`)).s === 404, "annuler n'existe pas pour les actualités");
  await api("POST", `${A}/${e.id}/publish`);
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier deux fois");
  must((await api("POST", `${A}/${e.id}/unpublish`)).b.data.status === "DRAFT", "dépublier");
  must((await api("GET", `/news/${e.translations.fr.slug}`, null, { auth: false })).s === 404, "visible après dépublication");
  must((await api("POST", `${A}/${e.id}/archive`)).b.data.state === "ARCHIVED", "archiver");
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier une archivée");
  must((await api("POST", `${A}/${e.id}/unarchive`)).b.data.status === "DRAFT", "désarchiver");
  const c = await mk({});
  const codes = (await Promise.all([api("POST", `${A}/${c.id}/publish`), api("POST", `${A}/${c.id}/publish`)])).map((r) => r.s).sort();
  must(codes[0] === 200 && codes[1] === 409, "simultané " + codes);
  must((await api("POST", `${A}/00000000-0000-4000-8000-000000000000/publish`)).s === 404, "inconnue");
});
await t("suppression logique : refusée si publiée ; corbeille ; restauration ; programmée restaurée en brouillon", async () => {
  const p = await mk({}); await api("POST", `${A}/${p.id}/publish`);
  must((await api("DELETE", `${A}/${p.id}`)).s === 409, "supprimer une publiée");
  const d = await mk({});
  must((await api("DELETE", `${A}/${d.id}`)).s === 200, "supprimer");
  must(!(await api("GET", `${A}?q=${tag}&limit=100`)).b.data.some((n) => n.id === d.id), "visible");
  must((await api("GET", `${A}?deleted=true&limit=100`)).b.data.some((n) => n.id === d.id), "corbeille");
  must((await api("PATCH", `${A}/${d.id}`, { isFeatured: true })).s === 404, "modifier une supprimée");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 200, "restaurer");
  const s = await mk({}); await api("POST", `${A}/${s.id}/schedule`, { publishAt: iso(2 * D) }); await api("DELETE", `${A}/${s.id}`);
  const r = await api("POST", `${A}/${s.id}/restore`);
  must(r.b.data.status === "DRAFT" && r.b.data.publishAt === null, "programmée");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 404, "restaurer une active");
});
await t("recherche, vedettes, tri (récentes d'abord), pagination, filtres d'état, paramètres invalides, injection", async () => {
  const k = `Rech${randomBytes(3).toString("hex")}`;
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const n = await mk({ isFeatured: i === 0 }, { fr: { title: `${k} actualité ${i}`, content: i === 2 ? `contient ${k}-corps` : "x" } });
    await api("POST", `${A}/${n.id}/publish`); ids.push(n.id);
    await new Promise((r) => setTimeout(r, 30));
  }
  const p1 = await api("GET", `/news?q=${k}&limit=2&page=1`, null, { auth: false });
  const p3 = await api("GET", `/news?q=${k}&limit=2&page=3`, null, { auth: false });
  must(p1.b.meta.total === 5 && p1.b.meta.totalPages === 3 && p1.b.data.length === 2 && p3.b.data.length === 1, JSON.stringify(p1.b.meta));
  must(p1.b.data[0].id === ids[4] && p1.b.data[1].id === ids[3], "plus récentes d'abord");
  must((await api("GET", `/news?q=${k}&featured=true`, null, { auth: false })).b.data.length === 1, "vedette");
  must((await api("GET", `${A}?q=${k}&state=PUBLISHED`)).b.data.length === 5 && (await api("GET", `${A}?q=${k}&state=DRAFT`)).b.data.length === 0, "état admin");
  const asc = await api("GET", `${A}?q=${k}&sort=publishedAt&order=asc`); must(asc.b.data[0].id === ids[0], "tri publishedAt asc");
  const range = await api("GET", `/news?q=${k}&from=${encodeURIComponent(iso(-H))}&to=${encodeURIComponent(iso(H))}`, null, { auth: false }); must(range.b.data.length === 5, "plage de dates");
  must((await api("GET", `${A}?limit=1000`)).s === 422 && (await api("GET", `${A}?state=FOO`)).s === 422 && (await api("GET", `${A}?sort=title`)).s === 422, "paramètres invalides");
  must((await api("GET", `${A}?q=${encodeURIComponent("'; DROP TABLE news;--")}`)).b.data.length === 0, "injection");
});
await t("audit : création, modification (noms de champs seulement), changement de statut, suppression, restauration", async () => {
  const log = (action) => prismaRaw.auditLog.findMany({ where: { entity: "news", action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map(log));
  must(c.length && u.length && st.length && d.length && r.length, `${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must(c[0].adminId && c[0].ipAddress, "adminId / ip");
  const upd = u.find((l) => l.changes?.translations?.fr);
  must(upd && Array.isArray(upd.changes.translations.fr.updated) && !JSON.stringify(upd.changes).includes("Résumé"), "le texte ne doit pas figurer dans l'audit");
  must(st.every((l) => l.changes.from && l.changes.to && l.changes.action), "changements de statut");
});
await t("base : contraintes CHECK (programmée sans date, slug invalide) et résistance aux statuts invalides", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  await bad(`insert into news ("status","updatedAt") values ('SCHEDULED', now())`, "SCHEDULED sans publishAt");
  await bad(`insert into news ("status","updatedAt") values ('CANCELLED', now())`, "statut CANCELLED (réservé aux événements)");
  await bad(`insert into news_translations ("newsId","language","slug","title","content") values ('${made[0]}','en','Pas Valide','t','c')`, "slug invalide");
});

// --- Nettoyage ---
await prismaRaw.news.deleteMany({ where: { id: { in: made } } });
await prismaRaw.storageFile.deleteMany({ where: { id: { in: [imgFile.id, pdfFile.id, upFile.id] } } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "news" } });
const left = await prismaRaw.news.count({ where: { translations: { some: { title: { contains: tag } } } } });
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} actualités restantes`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
