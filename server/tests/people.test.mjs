// Test d'intégration du module Personnes (table générique) : API HTTP réelle + vraie base.
// Aucun appel à Cloudinary. Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.
// Lancer : npm run test:people
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3123);
const base = "http://localhost:3123/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 280)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const A = "/admin/people";
const made = [];
const mk = async (firstName, lastName, over = {}) => {
  const r = await api("POST", A, { firstName, lastName, ...over });
  if (r.s !== 201) throw new Error("création " + r.s + JSON.stringify(r.b));
  made.push(r.b.data.id);
  return r.b.data;
};
const mkFile = (over = {}) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test-people/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "people", originalFilename: `ppl-${tag}.jpg`, mimeType: "image/jpeg", bytes: 1, width: 400, height: 400, checksum: randomBytes(32).toString("hex"), ...over } });
const photo = await mkFile();
const pdf = await mkFile({ resourceType: "RAW", mimeType: "application/pdf" });
const LAST = `Zz${tag}`; // nom de famille commun : isole les données de ce test dans les recherches

await t("sécurité : 401 sans token (admin) ; lecture publique libre", async () => {
  must((await api("GET", A, null, { auth: false })).s === 401 && (await api("POST", A, {}, { auth: false })).s === 401, "admin");
  must((await api("GET", "/people", null, { auth: false })).s === 200, "public");
});
await t("validation : noms, catégories, slug, photo, ordre, textes -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", A, body)).s === 422, label);
  await bad({ lastName: "Dupont" }, "sans prénom"); await bad({ firstName: "Jean" }, "sans nom");
  await bad({ firstName: "x".repeat(81), lastName: "Dupont" }, "prénom trop long"); await bad({ firstName: "", lastName: "Dupont" }, "prénom vide");
  await bad({ firstName: "Jean", lastName: "D", categories: ["KING"] }, "catégorie inconnue"); await bad({ firstName: "Jean", lastName: "D", categories: "PASTOR" }, "catégories non tableau");
  await bad({ firstName: "Jean", lastName: "D", slug: "Pas Valide" }, "slug"); await bad({ firstName: "Jean", lastName: "D", sortOrder: -3 }, "ordre");
  await bad({ firstName: "Jean", lastName: "D", photoId: pdf.id }, "photo PDF"); await bad({ firstName: "Jean", lastName: "D", photoId: "00000000-0000-4000-8000-000000000000" }, "photo inconnue");
  await bad({ firstName: "Jean", lastName: "D", translations: { fr: { bio: "x".repeat(5001) } } }, "biographie trop longue");
  await bad({ firstName: "Jean", lastName: "D", translations: { de: { bio: "x" } } }, "langue de");
});
let p1, p2;
await t("création : brouillon, slug généré (sans accents), doublon -2, catégories dédoublonnées, traduction vide ignorée", async () => {
  p1 = await mk("Élie", LAST, { categories: ["PASTOR", "SPEAKER", "PASTOR"], sortOrder: 5, translations: { fr: { title: "Pasteur principal", bio: "Serviteur de Dieu." }, en: {} } });
  must(p1.status === "DRAFT" && p1.name === `Élie ${LAST}` && p1.slug === `elie-${LAST.toLowerCase()}` && p1.categories.join() === "PASTOR,SPEAKER", JSON.stringify([p1.status, p1.slug, p1.categories]));
  must(p1.translations.fr.title === "Pasteur principal" && !p1.translations.en && p1.photo === null, "traductions");
  p2 = await mk("Élie", LAST, { sortOrder: 1 });
  must(p2.slug === p1.slug + "-2", "doublon : " + p2.slug);
  must((await api("POST", A, { firstName: "Autre", lastName: "Nom", slug: p1.slug })).s === 409, "slug explicite en conflit");
  const custom = await mk("Marie", LAST, { slug: `marie-${tag}-custom`, categories: [] });
  must(custom.slug === `marie-${tag}-custom` && custom.categories.length === 0, "slug explicite");
});
await t("modification : noms, catégories, photo (ajout/effacement null), textes FR/EN effaçables, slug ; archivée non modifiable", async () => {
  let r = await api("PATCH", `/admin/people/${p1.id}`, { photoId: photo.id, categories: ["TEAM", "LEADER"], lastName: LAST, translations: { en: { title: "Lead pastor", bio: "Servant of God." } } });
  must(r.s === 200 && r.b.data.photo?.url.startsWith("https://res.cloudinary.com/") && r.b.data.categories.join() === "TEAM,LEADER" && r.b.data.translations.en.title === "Lead pastor", JSON.stringify(r.b).slice(0, 250));
  r = await api("PATCH", `${A}/${p1.id}`, { photoId: null, translations: { fr: { bio: null }, en: null } });
  must(r.b.data.photo === null && r.b.data.translations.fr.bio === null && r.b.data.translations.fr.title === "Pasteur principal" && !r.b.data.translations.en, "effacer : " + JSON.stringify(r.b.data.translations));
  must(r.b.data.slug === p1.slug, "slug stable quand le nom ne change pas");
  r = await api("PATCH", `${A}/${p1.id}`, { slug: `nouveau-${tag}` }); must(r.s === 200 && r.b.data.slug === `nouveau-${tag}`, "slug explicite");
  must((await api("PATCH", `${A}/${p1.id}`, { slug: p2.slug })).s === 409, "slug pris");
  const same = await api("PATCH", `${A}/${p1.id}`, { categories: ["LEADER", "TEAM"] }); must(same.s === 200 && same.b.data.categories.join() === "TEAM,LEADER", "mêmes catégories dans un autre ordre : inchangé");
  must((await api("PATCH", `${A}/00000000-0000-4000-8000-000000000000`, { firstName: "X" })).s === 404, "inconnu");
  const e = await mk("Archive", LAST); await api("POST", `${A}/${e.id}/archive`);
  must((await api("PATCH", `${A}/${e.id}`, { firstName: "Y" })).s === 409, "modifier une archivée");
  await api("PATCH", `${A}/${p1.id}`, { photoId: photo.id, translations: { fr: { bio: "Serviteur de Dieu depuis 20 ans." }, en: { title: "Lead pastor", bio: "Servant of God for 20 years." } } });
});
await t("lecture publique : brouillon invisible ; publiée visible (liste, détail), champs internes masqués", async () => {
  must(!(await api("GET", `/people?q=${LAST}`, null, { auth: false })).b.data.length, "brouillon visible");
  must((await api("GET", `/people/${p1.slug}`, null, { auth: false })).s === 404, "détail d'un brouillon");
  must((await api("POST", `${A}/${p1.id}/publish`)).b.data.status === "PUBLISHED", "publier");
  const d = await api("GET", `/people/nouveau-${tag}`, null, { auth: false });
  must(d.s === 200 && d.h.get("cache-control") === "public, max-age=60", "détail " + d.s);
  must(d.b.data.name === `Élie ${LAST}` && d.b.data.title === "Pasteur principal" && d.b.data.bio.includes("20 ans") && d.b.data.photo?.url && d.b.data.sermonCount === 0, JSON.stringify(d.b.data).slice(0, 300));
  for (const k of ["status", "createdById", "deletedAt", "sortOrder", "publishedAt", "translations"]) must(!(k in d.b.data), "champ interne : " + k);
  const en = await api("GET", `/people/nouveau-${tag}?lang=en`, null, { auth: false }); must(en.b.data.title === "Lead pastor" && en.b.data.language === "en", "langue en");
  must((await api("GET", `/people/nouveau-${tag}`, null, { auth: false, headers: { "accept-language": "en-US" } })).b.data.language === "en", "Accept-Language");
  must((await api("GET", `/people/nouveau-${tag}?lang=de`, null, { auth: false })).s === 422, "lang=de");
  const l = (await api("GET", `/people?q=${LAST}`, null, { auth: false })).b.data[0]; must(l.bio.length <= 241 && !("sermonCount" in l), "liste : biographie abrégée");
});
await t("liste publique : catégories, recherche, ordre d'affichage puis nom, pagination ; paramètres invalides", async () => {
  await api("POST", `${A}/${p2.id}/publish`);
  const lst = await api("GET", `/people?q=${LAST}&limit=100`, null, { auth: false });
  must(lst.b.data.length === 2 && lst.b.data[0].id === p2.id && lst.b.data[1].id === p1.id, "ordre : sortOrder 1 avant 5 -> " + lst.b.data.map((x) => x.slug));
  must((await api("GET", `/people?q=${LAST}&category=PASTOR`, null, { auth: false })).b.data.length === 0 && (await api("GET", `/people?q=${LAST}&category=LEADER`, null, { auth: false })).b.data.length === 1, "catégorie");
  must((await api("GET", `/people?q=${encodeURIComponent("Servant of God")}`, null, { auth: false })).b.data.some((x) => x.id === p1.id), "recherche dans les biographies (toutes langues)");
  const pg = await api("GET", `/people?q=${LAST}&limit=1&page=2`, null, { auth: false }); must(pg.b.meta.total === 2 && pg.b.meta.totalPages === 2 && pg.b.data.length === 1, "pagination");
  must((await api("GET", `/people?category=KING`, null, { auth: false })).s === 422 && (await api("GET", `/people?limit=500`, null, { auth: false })).s === 422, "invalides");
  must(!(await api("GET", `/people?q=${encodeURIComponent("'; DROP TABLE people;--")}`, null, { auth: false })).b.data.length, "injection");
});
await t("transitions : dépublier, archiver, désarchiver ; invalides -> 409 ; publication simultanée", async () => {
  const e = await mk("Trans", LAST);
  must((await api("POST", `${A}/${e.id}/unpublish`)).s === 409 && (await api("POST", `${A}/${e.id}/unarchive`)).s === 409, "invalides depuis brouillon");
  await api("POST", `${A}/${e.id}/publish`);
  must((await api("POST", `${A}/${e.id}/publish`)).s === 409, "publier deux fois");
  must((await api("POST", `${A}/${e.id}/unpublish`)).b.data.status === "DRAFT" && (await api("GET", `/people/${e.slug}`, null, { auth: false })).s === 404, "dépublier");
  must((await api("POST", `${A}/${e.id}/archive`)).b.data.status === "ARCHIVED" && (await api("GET", `/people/${e.slug}`, null, { auth: false })).s === 404, "archiver");
  must((await api("POST", `${A}/${e.id}/unarchive`)).b.data.status === "DRAFT", "désarchiver");
  const c = await mk("Course", LAST);
  const codes = (await Promise.all([api("POST", `${A}/${c.id}/publish`), api("POST", `${A}/${c.id}/publish`)])).map((r) => r.s).sort();
  must(codes[0] === 200 && codes[1] === 409, "simultané " + codes);
  must((await api("POST", `${A}/00000000-0000-4000-8000-000000000000/publish`)).s === 404, "inconnu");
});
await t("suppression logique : refusée si publiée ; corbeille ; restauration ; administration : filtres et tri", async () => {
  const pub = await mk("Pub", LAST); await api("POST", `${A}/${pub.id}/publish`);
  must((await api("DELETE", `${A}/${pub.id}`)).s === 409, "supprimer une publiée");
  const d = await mk("Del", LAST);
  must((await api("DELETE", `${A}/${d.id}`)).s === 200, "supprimer");
  must(!(await api("GET", `${A}?q=${LAST}&limit=100`)).b.data.some((x) => x.id === d.id) && (await api("GET", `${A}?deleted=true&q=${LAST}&limit=100`)).b.data.some((x) => x.id === d.id), "corbeille");
  must((await api("PATCH", `${A}/${d.id}`, { firstName: "Z" })).s === 404, "modifier un supprimé");
  must((await api("POST", `${A}/${d.id}/restore`)).s === 200 && (await api("POST", `${A}/${d.id}/restore`)).s === 404, "restaurer");
  const ids = async (qs) => (await api("GET", `${A}?q=${LAST}&limit=100&${qs}`)).b.data.map((x) => x.id);
  must((await ids("status=PUBLISHED")).includes(pub.id) && !(await ids("status=PUBLISHED")).includes(d.id), "statut");
  must((await ids("category=LEADER")).join() === p1.id, "catégorie");
  const byName = (await api("GET", `${A}?q=${LAST}&limit=100&sort=lastName&order=asc`)).b.data.map((x) => x.firstName); must(byName.length >= 5, "tri par nom");
  for (const qs of ["limit=1000", "status=FOO", "sort=title", "category=X"]) must((await api("GET", `${A}?${qs}`)).s === 422, qs);
  must((await api("GET", `${A}/${p1.id}`)).b.data.translations.en.title === "Lead pastor" && (await api("GET", `${A}/abc`)).s === 422, "détail");
});
await t("audit : création, modification (jamais les biographies), statut, suppression, restauration", async () => {
  const log = (action) => prismaRaw.auditLog.findMany({ where: { entity: "people", action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map(log));
  must(c.length && u.length && st.length && d.length && r.length, `${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must(c[0].adminId && c[0].ipAddress, "adminId / ip");
  const dump = JSON.stringify([c, u]); must(!dump.includes("Serviteur") && !dump.includes("Servant") && !dump.includes("Pasteur principal"), "des textes figurent dans l'audit");
});
await t("base : contraintes (slug valide, catégorie enum, slug unique)", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|duplicate key|unique|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  await bad(`insert into people ("firstName","lastName","slug","updatedAt") values ('a','b','Pas Valide',now())`, "slug invalide");
  await bad(`insert into people ("firstName","lastName","slug","categories","updatedAt") values ('a','b','ok-${tag}-x','{KING}',now())`, "catégorie inconnue");
  await bad(`insert into people ("firstName","lastName","slug","updatedAt") values ('a','b','${p1.slug === `nouveau-${tag}` ? p1.slug : p2.slug}',now())`, "slug en double");
});

// --- Nettoyage ---
await prismaRaw.person.deleteMany({ where: { OR: [{ id: { in: made } }, { lastName: LAST }] } });
await prismaRaw.storageFile.deleteMany({ where: { id: { in: [photo.id, pdf.id] } } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "people" } });
const left = await prismaRaw.person.count({ where: { lastName: LAST } });
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} personnes restantes`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
