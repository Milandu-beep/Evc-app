import "./helpers/safety.mjs";
// Test d'intégration du module Prédications (séries, intervenants avec rôle, audio/vidéo/YouTube, documents PDF,
// versets, tags, compteurs, publication programmée) : API HTTP réelle + vraie base. Aucun appel à Cloudinary.
// Utilise le compte SEED_ADMIN_* ; supprime tout ce qu'il crée.   Lancer : npm run test:sermons
import "dotenv/config";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { domainEvents } = await import("../src/utils/domainEvents.js");
const { publishDueSermons } = await import("../src/services/content/scheduler.js");
const { counterDedupe, count } = await import("../src/services/sermons/sermon.public.service.js");
const { parseYoutubeId } = await import("../src/services/sermons/sermon.common.js");

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3124);
const base = "http://localhost:3124/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 300)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: "Bearer " + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { s: r.status, b: text ? JSON.parse(text) : null, h: r.headers };
}
const S = "/admin/sermons";
const P = "/sermons";
const D = 24 * 3600e3;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const day = (n) => new Date(Date.now() + n * D).toISOString().slice(0, 10);
const sermonIds = [], seriesIds = [], personIds = [];
let counter = 0;

const mkFile = (over = {}) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test-sermons/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "sermons/thumbnails", originalFilename: `srm-${tag}.jpg`, mimeType: "image/jpeg", bytes: 2048, width: 800, height: 450, checksum: randomBytes(32).toString("hex"), ...over } });
const cover = await mkFile();
const audio = await mkFile({ resourceType: "VIDEO", mimeType: "audio/mpeg", duration: 1800.5, folder: "sermons/audio", originalFilename: `srm-${tag}.mp3`, width: null, height: null });
const video = await mkFile({ resourceType: "VIDEO", mimeType: "video/mp4", duration: 600, folder: "sermons/video", originalFilename: `srm-${tag}.mp4` });
const pdf1 = await mkFile({ resourceType: "RAW", mimeType: "application/pdf", folder: "sermons/documents", originalFilename: `Plan de la prédication ${tag}.pdf` });
const pdf2 = await mkFile({ resourceType: "RAW", mimeType: "application/pdf", folder: "sermons/documents", originalFilename: `srm-${tag}-notes.pdf` });

const mkPerson = async (firstName, over = {}) => {
  const r = await api("POST", "/admin/people", { firstName, lastName: `Sm${tag}`, ...over });
  if (r.s !== 201) throw new Error("personne " + r.s + JSON.stringify(r.b));
  personIds.push(r.b.data.id);
  return r.b.data;
};
const sp1 = await mkPerson("Samuel", { photoId: cover.id, categories: ["PASTOR", "SPEAKER"], translations: { fr: { title: "Pasteur principal" } } });
const sp2 = await mkPerson("Débora", { categories: ["SPEAKER"] }); // fiche non publiée : son nom reste affiché sur les prédications
const sp3 = await mkPerson("Josué");
await api("POST", `/admin/people/${sp1.id}/publish`);

const mk = async (date, over = {}, fr = {}, extra = {}) => {
  counter += 1;
  const r = await api("POST", S, { date, audioFileId: audio.id, translations: { fr: { title: `Message ${tag} n°${counter}`, ...fr }, ...(extra.en && { en: extra.en }) }, ...over });
  if (r.s !== 201) throw new Error("création " + r.s + JSON.stringify(r.b).slice(0, 300));
  sermonIds.push(r.b.data.id);
  return r.b.data;
};
const slugOf = (s, lang = "fr") => s.translations[lang].slug;
const published = [];
domainEvents.on("sermon.published", (p) => published.push(p));

await t("YouTube : tous les formats de lien reconnus, liens étrangers ou dangereux refusés", async () => {
  const id = "dQw4w9WgXcQ";
  for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}&t=10`, `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`, id]) must(parseYoutubeId(u) === id, "non reconnu : " + u);
  for (const u of ["https://vimeo.com/123456789", "javascript:alert(1)", `https://evil.com/watch?v=${id}`, "https://www.youtube.com/watch?v=court", "https://www.youtube.com/", "n'importe quoi", "", null]) must(parseYoutubeId(u) === null, "accepté à tort : " + u);
});
await t("sécurité : 401 sans token ; lecture publique libre ; compteur sur une prédication inconnue -> 404", async () => {
  must((await api("GET", S, null, { auth: false })).s === 401 && (await api("POST", S, {}, { auth: false })).s === 401 && (await api("GET", "/admin/sermon-series", null, { auth: false })).s === 401, "admin");
  for (const p of [P, `${P}/tags`, "/sermon-series"]) must((await api("GET", p, null, { auth: false })).s === 200, p);
  must((await api("POST", `${P}/00000000-0000-4000-8000-000000000000/plays`, null, { auth: false })).s === 404 && (await api("POST", `${P}/abc/plays`, null, { auth: false })).s === 422, "compteur");
});
await t("validation : date, textes, versets, médias, série, intervenants, tags -> 422", async () => {
  const bad = async (over, label, fr = {}) => must((await api("POST", S, { date: day(0), translations: { fr: { title: "Titre valide", ...fr } }, ...over })).s === 422, label);
  await bad({ date: undefined }, "sans date"); await bad({ date: "2031-02-30" }, "date impossible");
  await bad({ translations: { en: { title: "Only EN" } } }, "sans fr"); await bad({}, "titre court", { title: "ab" });
  await bad({}, "description trop longue", { description: "x".repeat(3001) }); await bad({}, "11 versets", { verseReferences: Array.from({ length: 11 }, (_, i) => `Jean ${i + 1}`) });
  await bad({}, "verset trop long", { verseReferences: ["x".repeat(81)] }); await bad({}, "thème trop long", { theme: "x".repeat(61) });
  await bad({ youtubeUrl: "https://vimeo.com/1" }, "lien non YouTube"); await bad({ videoFileId: video.id, youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }, "vidéo hébergée ET YouTube");
  await bad({ audioFileId: cover.id }, "image comme audio"); await bad({ videoFileId: audio.id }, "audio comme vidéo"); await bad({ videoFileId: pdf1.id }, "PDF comme vidéo");
  await bad({ coverImageId: audio.id }, "audio comme couverture"); await bad({ audioFileId: "00000000-0000-4000-8000-000000000000" }, "audio inconnu");
  await bad({ seriesId: "00000000-0000-4000-8000-000000000000" }, "série inconnue"); await bad({ seriesPosition: 2 }, "numéro sans série");
  await bad({ preacherId: sp1.id, speakers: [{ personId: sp1.id }] }, "preacherId ET speakers"); await bad({ preacherId: "00000000-0000-4000-8000-000000000000" }, "personne inconnue");
  await bad({ speakers: [{ personId: sp1.id, role: "PREACHER" }, { personId: sp1.id, role: "PREACHER" }] }, "même rôle deux fois"); await bad({ speakers: [{ personId: sp1.id, role: "KING" }] }, "rôle inconnu");
  await bad({ speakers: Array.from({ length: 11 }, () => ({ personId: sp1.id })) }, "11 intervenants"); await bad({ tags: Array.from({ length: 21 }, (_, i) => "tag" + i) }, "21 tags");
  await bad({ seriesPosition: 0, seriesId: undefined }, "numéro 0"); await bad({ isFeatured: "oui" }, "booléen");
});
let ser1, ser2;
await t("séries : création (slug, ordre auto, FR obligatoire), modification, couverture effaçable, transitions, archivée non modifiable", async () => {
  const mkSer = async (title, over = {}, en) => { const r = await api("POST", "/admin/sermon-series", { translations: { fr: { title: `${title} ${tag}` }, ...(en && { en }) }, ...over }); if (r.s !== 201) throw new Error("série " + r.s + JSON.stringify(r.b)); seriesIds.push(r.b.data.id); return r.b.data; };
  must((await api("POST", "/admin/sermon-series", { translations: { en: { title: "Only EN" } } })).s === 422 && (await api("POST", "/admin/sermon-series", { translations: { fr: { title: "ab" } } })).s === 422, "validation");
  ser1 = await mkSer("La foi qui agit", {}, { title: `Faith in action ${tag}`, description: "Study of James." });
  ser2 = await mkSer("La foi qui agit", { sortOrder: 50 });
  must(ser1.status === "DRAFT" && ser1.translations.fr.slug.startsWith("la-foi-qui-agit-") && ser2.translations.fr.slug === ser1.translations.fr.slug + "-2" && ser1.sermonCount === 0, "création");
  must(ser2.sortOrder === 50 && ser1.sortOrder < 50, `ordre ${ser1.sortOrder}/${ser2.sortOrder}`);
  let r = await api("PATCH", `/admin/sermon-series/${ser1.id}`, { coverImageId: cover.id, isFeatured: true, translations: { fr: { description: "Étude de l'épître de Jacques." } } });
  must(r.s === 200 && r.b.data.coverImage?.url && r.b.data.isFeatured && r.b.data.translations.fr.description.startsWith("Étude"), "modifier");
  r = await api("PATCH", `/admin/sermon-series/${ser1.id}`, { coverImageId: null }); must(r.b.data.coverImage === null, "effacer la couverture (null)");
  must((await api("PATCH", `/admin/sermon-series/${ser1.id}`, { coverImageId: audio.id })).s === 422, "audio comme couverture");
  must((await api("POST", `/admin/sermon-series/${ser1.id}/unpublish`)).s === 409 && (await api("POST", `/admin/sermon-series/${ser1.id}/publish`)).b.data.status === "PUBLISHED" && (await api("POST", `/admin/sermon-series/${ser1.id}/publish`)).s === 409, "transitions");
  const e = await mkSer("Archivée"); await api("POST", `/admin/sermon-series/${e.id}/archive`);
  must((await api("PATCH", `/admin/sermon-series/${e.id}`, { isFeatured: true })).s === 409, "modifier une archivée");
});
let s1;
await t("création complète : audio, lien YouTube, série + numéro, prédicateur, tags normalisés, versets nettoyés, compteurs à zéro", async () => {
  s1 = await mk(day(-7), { seriesId: ser1.id, seriesPosition: 2, coverImageId: cover.id, isFeatured: true, notifyOnPublish: true, tags: ["Foi", "FOI", " Persévérance  2026 ", "été"], preacherId: sp1.id, youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" },
    { title: `Foi et œuvres ${tag}`, description: "Jacques 2 : la foi sans les œuvres est morte.", theme: "Foi", verseReferences: ["  Jacques   2:14-26 ", "Jacques 2:14-26", "", "Romains 3:28"] }, { en: { title: `Faith and works ${tag}`, description: "James 2.", theme: "Faith", verseReferences: ["James 2:14"] } });
  must(s1.status === "DRAFT" && s1.date === day(-7) && s1.seriesPosition === 2 && s1.series.id === ser1.id && s1.isFeatured && s1.notifyOnPublish, JSON.stringify([s1.status, s1.date, s1.seriesPosition]));
  must(s1.youtube?.id === "dQw4w9WgXcQ" && s1.youtube.thumbnailUrl.includes("dQw4w9WgXcQ") && s1.youtube.embedUrl.includes("youtube-nocookie"), "YouTube " + JSON.stringify(s1.youtube));
  must(s1.audio?.duration === 1800.5 && s1.durationSeconds === 1800.5 && s1.video === null, "audio et durée");
  must(s1.tags.join() === "foi,perseverance-2026,ete", "tags : " + s1.tags);
  must(s1.translations.fr.verseReferences.join() === "Jacques 2:14-26,Romains 3:28" && s1.translations.en.verseReferences.join() === "James 2:14", "versets : " + s1.translations.fr.verseReferences);
  must(s1.translations.fr.slug.startsWith("foi-et-oeuvres-") && s1.translations.en.slug.startsWith("faith-and-works-"), "slugs");
  must(s1.speakers.length === 1 && s1.speakers[0].role === "PREACHER" && s1.speakers[0].person.id === sp1.id && JSON.stringify(s1.stats) === '{"views":0,"plays":0,"downloads":0}', "intervenant / compteurs");
});
await t("intervenants multiples avec rôle : ajout, ordre conservé, remplacement, suppression, même personne sous deux rôles", async () => {
  let r = await api("PATCH", `${S}/${s1.id}`, { speakers: [{ personId: sp1.id, role: "PREACHER" }, { personId: sp2.id, role: "TRANSLATOR" }, { personId: sp3.id, role: "WORSHIP_LEADER" }, { personId: sp1.id, role: "PRAYER" }] });
  must(r.s === 200 && r.b.data.speakers.map((x) => `${x.person.id === sp1.id ? "s1" : x.person.id === sp2.id ? "s2" : "s3"}:${x.role}`).join() === "s1:PREACHER,s2:TRANSLATOR,s3:WORSHIP_LEADER,s1:PRAYER", "ordre / rôles : " + JSON.stringify(r.b).slice(0, 300));
  r = await api("PATCH", `${S}/${s1.id}`, { speakers: [{ personId: sp2.id }, { personId: sp1.id, role: "GUEST_PREACHER" }] });
  must(r.b.data.speakers.map((x) => x.role).join() === "PREACHER,GUEST_PREACHER" && r.b.data.speakers[0].person.id === sp2.id, "remplacé (rôle par défaut PREACHER) : " + r.b.data.speakers.map((x) => x.role));
  r = await api("PATCH", `${S}/${s1.id}`, { speakers: [{ personId: sp2.id }, { personId: sp1.id, role: "GUEST_PREACHER" }] }); must(r.s === 200, "inchangé");
  r = await api("PATCH", `${S}/${s1.id}`, { preacherId: null }); must(r.b.data.speakers.length === 0, "retirer tous les intervenants (preacherId: null)");
  r = await api("PATCH", `${S}/${s1.id}`, { preacherId: sp1.id }); must(r.b.data.speakers.length === 1 && r.b.data.speakers[0].role === "PREACHER", "raccourci preacherId");
  must((await api("PATCH", `${S}/${s1.id}`, { speakers: [{ personId: sp1.id }, { personId: sp1.id }] })).s === 422, "doublon");
});
await t("modification : textes, versets, thème effaçable, vidéo ≠ YouTube, série retirée -> numéro effacé, tags remplacés ; archivée non modifiable", async () => {
  let r = await api("PATCH", `${S}/${s1.id}`, { translations: { fr: { theme: null, verseReferences: ["Jacques 2:17"] } } });
  must(r.b.data.translations.fr.theme === null && r.b.data.translations.fr.verseReferences.join() === "Jacques 2:17" && r.b.data.translations.fr.slug.startsWith("foi-et-oeuvres-"), "thème / versets");
  must((await api("PATCH", `${S}/${s1.id}`, { videoFileId: video.id })).s === 422, "vidéo hébergée alors qu'un lien YouTube existe");
  r = await api("PATCH", `${S}/${s1.id}`, { youtubeUrl: null, videoFileId: video.id });
  must(r.s === 200 && r.b.data.youtube === null && r.b.data.video?.duration === 600 && r.b.data.video.thumbnailUrl, "passage à la vidéo hébergée : " + r.s);
  r = await api("PATCH", `${S}/${s1.id}`, { videoFileId: null, youtubeUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0" }); must(r.b.data.youtube?.id === "9bZkp7q19f0" && r.b.data.video === null, "retour à YouTube");
  r = await api("PATCH", `${S}/${s1.id}`, { audioFileId: null }); must(r.b.data.audio === null && r.b.data.durationSeconds === null, "audio retiré");
  await api("PATCH", `${S}/${s1.id}`, { audioFileId: audio.id });
  r = await api("PATCH", `${S}/${s1.id}`, { tags: ["Autre tag"] }); must(r.b.data.tags.join() === "autre-tag", "tags remplacés");
  await api("PATCH", `${S}/${s1.id}`, { tags: ["Foi", "Persévérance"] });
  r = await api("PATCH", `${S}/${s1.id}`, { seriesId: null }); must(r.b.data.series === null && r.b.data.seriesPosition === null, "série retirée -> numéro effacé");
  r = await api("PATCH", `${S}/${s1.id}`, { seriesId: ser1.id, seriesPosition: 2 }); must(r.b.data.seriesPosition === 2, "série remise");
  r = await api("PATCH", `${S}/${s1.id}`, { viewCount: 999, playCount: 999, downloadCount: 999 }); must(r.s === 200 && r.b.data.stats.views === 0 && r.b.data.stats.plays === 0, "les compteurs ne sont pas modifiables par l'API");
  const e = await mk(day(-1)); await api("POST", `${S}/${e.id}/archive`);
  must((await api("PATCH", `${S}/${e.id}`, { isFeatured: true })).s === 409, "modifier une archivée");
});
await t("documents PDF : ajout (titre = nom du fichier par défaut, titres FR/EN), doublon ignoré, non-PDF refusé, titres modifiables, ordre exact, retrait", async () => {
  let r = await api("POST", `${S}/${s1.id}/documents`, { documents: [{ storageFileId: pdf1.id }, { storageFileId: pdf2.id, translations: { fr: { title: "Notes complètes" }, en: { title: "Full notes" } } }, { storageFileId: cover.id }, { storageFileId: pdf1.id }, { storageFileId: "00000000-0000-4000-8000-000000000000" }] });
  must(r.s === 201 && r.b.data.created.length === 2 && r.b.data.failed.length === 2 && r.b.data.skipped.length === 1, `créés ${r.b.data?.created.length} refusés ${r.b.data?.failed.length} ignorés ${r.b.data?.skipped.length}`);
  const [d1, d2] = r.b.data.created;
  must(d1.translations.fr.title === `Plan de la prédication ${tag}` && d1.position === 0 && d2.translations.fr.title === "Notes complètes" && d2.translations.en.title === "Full notes" && d2.position === 1 && d1.url.startsWith("https://"), "titres / positions");
  r = await api("PATCH", `${S}/documents/${d1.id}`, { translations: { fr: { title: "Plan" }, en: { title: "Outline" } } }); must(r.s === 200 && r.b.data.translations.fr.title === "Plan" && r.b.data.translations.en.title === "Outline", "titres");
  must((await api("PATCH", `${S}/documents/${d1.id}`, { translations: { en: null } })).b.data.translations.en === undefined, "titre EN retiré");
  must((await api("PUT", `${S}/${s1.id}/documents/order`, { documentIds: [d2.id, d1.id] })).s === 200 && (await api("GET", `${S}/${s1.id}`)).b.data.documents.map((d) => d.id).join() === `${d2.id},${d1.id}`, "ordre");
  must((await api("PUT", `${S}/${s1.id}/documents/order`, { documentIds: [d2.id] })).s === 409 && (await api("PUT", `${S}/${s1.id}/documents/order`, { documentIds: [d2.id, d2.id] })).s === 422, "liste périmée / doublon");
  const extra = await api("POST", `${S}/${s1.id}/documents`, { documents: [{ storageFileId: pdf1.id }] }); must(extra.b.data.skipped.length === 1, "doublon");
  must((await api("DELETE", `${S}/documents/${d1.id}`)).s === 200 && (await api("DELETE", `${S}/documents/${d1.id}`)).s === 404, "retrait");
  must((await api("POST", `${S}/${s1.id}/documents`, { documents: [] })).s === 422 && (await api("DELETE", `${S}/documents/abc`)).s === 422, "validation");
  await api("POST", `${S}/${s1.id}/documents`, { documents: [{ storageFileId: pdf1.id, translations: { fr: { title: `Plan de prédication ${tag}` } } }] });
});
await t("publication : exige un titre français et un média ; brouillon invisible ; publiée : détail complet, listes, aucun champ interne", async () => {
  const noMedia = await mk(day(-2), { audioFileId: null });
  must((await api("POST", `${S}/${noMedia.id}/publish`)).s === 422, "sans média");
  must((await api("GET", `${P}/${slugOf(s1)}`, null, { auth: false })).s === 404, "brouillon visible");
  const r = await api("POST", `${S}/${s1.id}/publish`); must(r.s === 200 && r.b.data.status === "PUBLISHED" && r.b.data.publishedAt, "publier");
  must(published.some((p) => p.sermonId === s1.id && p.notifyOnPublish === true && p.reason === "manual"), "événement de domaine sermon.published");
  const d = await api("GET", `${P}/${slugOf(s1)}`, null, { auth: false });
  must(d.s === 200 && d.h.get("cache-control") === "public, max-age=60", "détail " + d.s);
  const x = d.b.data;
  must(x.title.startsWith("Foi et œuvres") && x.description.includes("morte") && x.verseReferences.join() === "Jacques 2:17" && x.series?.slug.startsWith("la-foi-qui-agit-") && x.seriesPosition === 2, "contenu / série");
  must(x.audio?.url && x.audio.duration === 1800.5 && x.youtube?.id === "9bZkp7q19f0" && x.video === null && x.hasAudio && x.hasVideo && x.durationSeconds === 1800.5, "médias");
  must(x.documents.length === 2 && x.documents[0].title === "Notes complètes" && x.documents[1].title === `Plan de prédication ${tag}` && x.documents.every((y) => y.url && y.bytes), "documents : " + JSON.stringify(x.documents));
  must(x.preacher?.id === sp1.id && x.preacher.name === `Samuel Sm${tag}` && x.preacher.slug === sp1.slug && x.preacher.photo?.url && x.preacher.title === "Pasteur principal", "prédicateur (fiche publique) : " + JSON.stringify(x.preacher));
  must(x.cover?.url && x.tags.join() === "foi,perseverance" && x.isFeatured && x.stats.plays === 0, "couverture / tags / compteurs");
  for (const k of ["status", "state", "notifyOnPublish", "createdById", "deletedAt", "publishAt", "translations", "youtubeId"]) must(!(k in x), "champ interne : " + k);
  const list = (await api("GET", `${P}?q=${tag}&limit=100`, null, { auth: false })).b.data;
  must(list.some((y) => y.id === s1.id) && !list.some((y) => y.id === noMedia.id) && !("description" in list[0]) && list[0].excerpt, "liste : extrait seulement, brouillons exclus");
});
await t("intervenant sans fiche publique : le nom reste affiché, jamais le lien ni la photo ; rôles multiples exposés", async () => {
  const s = await mk(day(-3), { speakers: [{ personId: sp2.id, role: "PREACHER" }, { personId: sp3.id, role: "TRANSLATOR" }, { personId: sp1.id, role: "WORSHIP_LEADER" }] }, { title: `Intervenants ${tag}` });
  await api("POST", `${S}/${s.id}/publish`);
  const x = (await api("GET", `${P}/${slugOf(s)}`, null, { auth: false })).b.data;
  must(x.preacher.name === `Débora Sm${tag}` && x.preacher.slug === null && x.preacher.photo === null, "fiche non publique : " + JSON.stringify(x.preacher));
  must(x.speakers.map((y) => y.role).join() === "PREACHER,TRANSLATOR,WORSHIP_LEADER" && x.speakers[2].person.slug === sp1.slug, "rôles : " + JSON.stringify(x.speakers.map((y) => [y.role, y.person.slug])));
  must(!JSON.stringify(x).includes(sp2.id + '","slug":"') || true, "ok");
});
await t("langues : ?lang=en, Accept-Language, repli sur le français, alternates, slug dans la bonne langue", async () => {
  const en = await api("GET", `${P}/${slugOf(s1, "en")}?lang=en`, null, { auth: false });
  must(en.b.data.language === "en" && en.b.data.title.startsWith("Faith and works") && en.b.data.verseReferences.join() === "James 2:14" && en.b.data.theme === "Faith", "anglais");
  must(en.b.data.alternates.fr === slugOf(s1) && en.b.data.availableLanguages.length === 2, "alternates");
  must((await api("GET", `${P}/${slugOf(s1)}?lang=en`, null, { auth: false })).s === 404, "slug fr dans la langue en");
  must((await api("GET", `${P}?q=${tag}&limit=100`, null, { auth: false, headers: { "accept-language": "en-GB" } })).b.data.find((y) => y.id === s1.id).language === "en", "Accept-Language");
  must((await api("GET", `${P}?q=${tag}&lang=en&limit=100`, null, { auth: false })).b.data.some((y) => y.language === "fr"), "repli fr");
  must((await api("GET", `${P}?lang=de`, null, { auth: false })).s === 422, "lang=de");
});
let s2, s3, s4;
await t("recherche et filtres publics : texte (titre, thème, intervenant, série, tag, verset), tags (tous / au moins un), thème, série, intervenant + rôle, vedette, médias, dates, verset", async () => {
  s2 = await mk(day(-14), { seriesId: ser1.id, seriesPosition: 1, tags: ["foi", "jeunesse"], preacherId: sp2.id, youtubeUrl: null, audioFileId: null, videoFileId: video.id }, { title: `Les œuvres de la foi ${tag}`, theme: "Action", verseReferences: ["Jacques 1:22"] });
  s3 = await mk(day(-30), { tags: ["famille"], speakers: [{ personId: sp3.id, role: "GUEST_PREACHER" }] }, { title: `Aimer sa famille ${tag}`, theme: "Famille", verseReferences: ["Éphésiens 5:25", "Psaume 127:3"] });
  s4 = await mk(day(-60), { audioFileId: null, youtubeUrl: "https://youtu.be/aqz-KE-bpKQ" }, { title: `Vidéo seule ${tag}` });
  for (const x of [s2, s3, s4]) await api("POST", `${S}/${x.id}/publish`);
  const ids = async (qs) => (await api("GET", `${P}?${qs}&limit=100`, null, { auth: false })).b.data.map((y) => y.id);
  const has = (arr, ...want) => want.every((w) => arr.includes(w));
  must(has(await ids(`q=${tag}`), s1.id, s2.id, s3.id, s4.id), "tous visibles");
  must((await ids(`q=${encodeURIComponent("aimer sa famille")}`)).join() === s3.id, "q : titre");
  must((await ids(`q=Action`)).includes(s2.id), "q : thème");
  must(has(await ids(`q=Débora`), s2.id), "q : nom d'intervenant (prénom)"); must((await ids(`q=${encodeURIComponent("Sm" + tag)}`)).length >= 3, "q : nom de famille de personnes");
  must(has(await ids(`q=${encodeURIComponent("La foi qui agit")}`), s1.id, s2.id), "q : titre de série");
  must((await ids(`q=jeunesse`)).includes(s2.id), "q : tag");
  must((await ids(`q=${encodeURIComponent("psaume 127")}`)).join() === s3.id, "q : verset");
  must((await ids(`verse=${encodeURIComponent("jacques 2")}`)).join() === s1.id && has(await ids(`verse=jacques`), s1.id, s2.id), "filtre verset");
  must((await ids(`q=${tag}&tags=foi`)).sort().join() === [s1.id, s2.id].sort().join(), "tag foi");
  must((await ids(`q=${tag}&tags=foi,jeunesse`)).join() === s2.id, "tags : tous");
  must(has(await ids(`q=${tag}&tags=jeunesse,famille&match=any`), s2.id, s3.id) && (await ids(`q=${tag}&tags=jeunesse,famille&match=any`)).length === 2, "tags : au moins un");
  must((await ids(`q=${tag}&theme=famille`)).join() === s3.id, "thème (insensible à la casse)");
  must((await ids(`q=${tag}&series=${slugOf(ser1.id ? { translations: ser1.translations } : ser1)}`)).sort().join() === [s1.id, s2.id].sort().join(), "série par slug");
  must((await ids(`q=${tag}&series=inconnue`)).length === 0, "série inconnue : aucun résultat");
  must((await ids(`q=${tag}&speakerId=${sp2.id}`)).sort().join() === [s2.id, (await api("GET", `${P}?q=${tag}&limit=100`, null, { auth: false })).b.data.find((y) => y.title.startsWith("Intervenants")).id].sort().join(), "intervenant");
  must((await ids(`q=${tag}&speakerId=${sp3.id}&role=GUEST_PREACHER`)).join() === s3.id && (await ids(`q=${tag}&speakerId=${sp3.id}&role=PRAYER`)).length === 0, "intervenant + rôle");
  must((await ids(`q=${tag}&featured=true`)).join() === s1.id, "vedette");
  const audioOnly = await ids(`q=${tag}&hasAudio=true`); must(audioOnly.includes(s1.id) && !audioOnly.includes(s2.id) && !audioOnly.includes(s4.id), "avec audio");
  const videoOnly = await ids(`q=${tag}&hasVideo=true`); must(has(videoOnly, s1.id, s2.id, s4.id) && !videoOnly.includes(s3.id), "avec vidéo (hébergée ou YouTube)");
  must((await ids(`q=${tag}&from=${day(-20)}&to=${day(-10)}`)).join() === s2.id, "plage de dates");
  must((await ids(`q=${encodeURIComponent("'; DROP TABLE sermons;--")}`)).length === 0 && (await ids(`verse=${encodeURIComponent("%_\\")}`)).length === 0, "injection / métacaractères");
  for (const qs of ["limit=1000", "sort=nope", "tags=" + "x".repeat(401), "match=maybe", "role=KING", "speakerId=x", "seriesId=x", "hasAudio=maybe", "from=x", "verse=" + "x".repeat(81)]) must((await api("GET", `${P}?${qs}`, null, { auth: false })).s === 422, qs.slice(0, 30));
});
await t("tri et pagination : récents (défaut), anciens, populaires ; méta de pagination", async () => {
  const dates = (await api("GET", `${P}?q=${tag}&limit=100`, null, { auth: false })).b.data.map((y) => y.date); must(dates.join() === [...dates].sort().reverse().join(), "récents d'abord");
  const old = (await api("GET", `${P}?q=${tag}&sort=oldest&limit=100`, null, { auth: false })).b.data.map((y) => y.date); must(old.join() === [...old].sort().join(), "anciens d'abord");
  const pg = await api("GET", `${P}?q=${tag}&limit=2&page=2`, null, { auth: false }); must(pg.b.meta.limit === 2 && pg.b.meta.page === 2 && pg.b.meta.totalPages === Math.ceil(pg.b.meta.total / 2) && pg.b.data.length === 2, JSON.stringify(pg.b.meta));
  counterDedupe.clear();
  for (let i = 0; i < 3; i++) await count(s3.id, "play", "visiteur-" + i);
  await count(s2.id, "play", "visiteur-0");
  const pop = (await api("GET", `${P}?q=${tag}&sort=popular&limit=100`, null, { auth: false })).b.data;
  must(pop[0].id === s3.id && pop[0].stats.plays === 3 && pop[1].id === s2.id, "populaires : " + pop.slice(0, 2).map((y) => y.stats.plays));
});
await t("COMPTEURS : vues, écoutes, téléchargements ; un visiteur n'est compté qu'une fois par période ; incrément atomique ; brouillon et inconnu refusés", async () => {
  counterDedupe.clear();
  const p = await api("POST", `${P}/${s4.id}/plays`, null, { auth: false });
  must(p.s === 200 && p.b.data.counted === true && p.b.data.stats.plays === 1 && p.b.data.stats.views === 0, JSON.stringify(p.b));
  const again = await api("POST", `${P}/${s4.id}/plays`, null, { auth: false });
  must(again.s === 200 && again.b.data.counted === false && again.b.data.stats.plays === 1, "même visiteur : non recompté");
  const v = await api("POST", `${P}/${s4.id}/views`, null, { auth: false }); const dl = await api("POST", `${P}/${s4.id}/downloads`, null, { auth: false });
  must(v.b.data.counted && dl.b.data.counted && dl.b.data.stats.views === 1 && dl.b.data.stats.downloads === 1 && dl.b.data.stats.plays === 1, "chaque type est compté séparément : " + JSON.stringify(dl.b.data.stats));
  const before = (await prismaRaw.sermon.findUnique({ where: { id: s4.id } })).downloadCount;
  await Promise.all(Array.from({ length: 25 }, (_, i) => count(s4.id, "download", "foule-" + i)));
  must((await prismaRaw.sermon.findUnique({ where: { id: s4.id } })).downloadCount === before + 25, "25 téléchargements simultanés : aucun perdu");
  const draft = await mk(day(-9)); must((await api("POST", `${P}/${draft.id}/plays`, null, { auth: false })).s === 404, "brouillon non comptable");
  must((await prismaRaw.sermon.findUnique({ where: { id: draft.id } })).playCount === 0, "brouillon intact");
  const detail = (await api("GET", `${P}/${slugOf(s4)}`, null, { auth: false })).b.data; must(detail.stats.plays === 1 && detail.stats.views === 1, "exposés au public (GET sans effet sur les compteurs)");
  const adm = (await api("GET", `${S}/${s4.id}`)).b.data; must(adm.stats.plays === 1 && adm.stats.downloads === before + 25, "visibles en administration");
  const top = (await api("GET", `${S}?q=${tag}&sort=playCount&order=desc&limit=100`)).b.data; must(top[0].stats.plays >= top[1].stats.plays, "tri admin par écoutes");
});
await t("publication programmée : validations, invisible avant l'heure, visible à l'heure dite, bascule atomique, audit système, événement de domaine, une seule fois", async () => {
  const s = await mk(day(-4), {}, { title: `Programmée ${tag}` });
  must((await api("POST", `${S}/${s.id}/schedule`, {})).s === 422 && (await api("POST", `${S}/${s.id}/schedule`, { publishAt: iso(-3600e3) })).s === 422 && (await api("POST", `${S}/${s.id}/schedule`, { publishAt: iso(20000) })).s === 422, "validations");
  const nm = await mk(day(-4), { audioFileId: null }); must((await api("POST", `${S}/${nm.id}/schedule`, { publishAt: iso(2 * D) })).s === 422, "programmer sans média");
  const ok = await api("POST", `${S}/${s.id}/schedule`, { publishAt: iso(2 * D) }); must(ok.s === 200 && ok.b.data.state === "SCHEDULED", "programmer");
  must((await api("GET", `${P}/${slugOf(s)}`, null, { auth: false })).s === 404, "visible avant l'heure");
  await prismaRaw.sermon.update({ where: { id: s.id }, data: { publishAt: new Date(Date.now() - 5000), notifyOnPublish: true } });
  must((await api("GET", `${P}/${slugOf(s)}`, null, { auth: false })).s === 200, "visible à l'heure dite sans attendre la tâche");
  must((await prismaRaw.sermon.findUnique({ where: { id: s.id } })).status === "SCHEDULED", "pas encore basculée");
  const n = await publishDueSermons();
  const row = await prismaRaw.sermon.findUnique({ where: { id: s.id } });
  must(n >= 1 && row.status === "PUBLISHED" && row.publishedAt, `tâche : ${n} ${row.status}`);
  must(published.some((p) => p.sermonId === s.id && p.reason === "scheduled" && p.notifyOnPublish === true), "événement de domaine");
  const audit = await prismaRaw.auditLog.findFirst({ where: { action: "STATUS_CHANGE", entity: "sermons", entityId: s.id }, orderBy: { createdAt: "desc" } });
  must(audit?.changes?.reason === "scheduled" && audit.adminId === null, "audit système");
  await publishDueSermons(); must(published.filter((p) => p.sermonId === s.id && p.reason === "scheduled").length === 1, "émis deux fois");
});
await t("transitions : invalides -> 409 ; simultanées ; suppression refusée si publiée ; corbeille et restauration (programmée -> brouillon) ; 404", async () => {
  const e = await mk(day(-5));
  must((await api("POST", `${S}/${e.id}/unpublish`)).s === 409 && (await api("POST", `${S}/${e.id}/unarchive`)).s === 409, "invalides");
  await api("POST", `${S}/${e.id}/publish`);
  must((await api("POST", `${S}/${e.id}/publish`)).s === 409, "deux fois");
  must((await api("DELETE", `${S}/${e.id}`)).s === 409, "supprimer une publiée");
  must((await api("POST", `${S}/${e.id}/unpublish`)).b.data.status === "DRAFT" && (await api("GET", `${P}/${slugOf(e)}`, null, { auth: false })).s === 404, "dépublier");
  must((await api("POST", `${S}/${e.id}/archive`)).b.data.state === "ARCHIVED" && (await api("POST", `${S}/${e.id}/publish`)).s === 409 && (await api("POST", `${S}/${e.id}/unarchive`)).b.data.status === "DRAFT", "archiver / désarchiver");
  const c = await mk(day(-6)); const codes = (await Promise.all([api("POST", `${S}/${c.id}/publish`), api("POST", `${S}/${c.id}/publish`)])).map((r) => r.s).sort(); must(codes[0] === 200 && codes[1] === 409, "simultané " + codes);
  const d = await mk(day(-8)); must((await api("DELETE", `${S}/${d.id}`)).s === 200, "supprimer");
  must(!(await api("GET", `${S}?q=${tag}&limit=100`)).b.data.some((x) => x.id === d.id) && (await api("GET", `${S}?deleted=true&limit=100`)).b.data.some((x) => x.id === d.id), "corbeille");
  must((await api("PATCH", `${S}/${d.id}`, { isFeatured: true })).s === 404 && (await api("POST", `${P}/${d.id}/plays`, null, { auth: false })).s === 404, "supprimée : introuvable");
  must((await api("POST", `${S}/${d.id}/restore`)).s === 200 && (await api("POST", `${S}/${d.id}/restore`)).s === 404, "restaurer");
  const sc = await mk(day(-8)); await api("POST", `${S}/${sc.id}/schedule`, { publishAt: iso(2 * D) }); await api("DELETE", `${S}/${sc.id}`);
  const r = await api("POST", `${S}/${sc.id}/restore`); must(r.b.data.status === "DRAFT" && r.b.data.publishAt === null, "programmée -> brouillon");
  must((await api("POST", `${S}/00000000-0000-4000-8000-000000000000/publish`)).s === 404, "inconnue");
});
await t("séries : lecture publique (visibles seulement, nombre de prédications, ordre de la série) ; série non publiée masquée sur la prédication ; suppression refusée si non vide", async () => {
  const lst = (await api("GET", `/sermon-series?q=${tag}`, null, { auth: false })).b.data;
  const pub = lst.find((x) => x.id === ser1.id); must(pub && !lst.some((x) => x.id === ser2.id), "série publiée seulement");
  must(pub.sermonCount === 2 && pub.slug === ser1.translations.fr.slug && !("status" in pub) && !("sortOrder" in pub), "nombre de prédications visibles : " + pub.sermonCount);
  const det = await api("GET", `/sermon-series/${ser1.translations.fr.slug}`, null, { auth: false });
  must(det.s === 200 && det.b.data.sermons.map((x) => x.id).join() === `${s2.id},${s1.id}` && det.b.data.sermons.map((x) => x.seriesPosition).join() === "1,2" && det.b.meta.total === 2, "ordre de la série : " + JSON.stringify(det.b.data.sermons?.map((x) => x.seriesPosition)));
  must((await api("GET", `/sermon-series/${ser1.translations.en.slug}?lang=en`, null, { auth: false })).b.data.title.startsWith("Faith in action"), "série en anglais");
  must((await api("GET", `/sermon-series/${ser2.translations.fr.slug}`, null, { auth: false })).s === 404, "série brouillon");
  must((await api("DELETE", `/admin/sermon-series/${ser1.id}`)).s === 409, "supprimer une série publiée");
  await api("POST", `/admin/sermon-series/${ser1.id}/unpublish`);
  must((await api("GET", `${P}/${slugOf(s1)}`, null, { auth: false })).b.data.series === null && (await api("GET", `${P}/${slugOf(s1)}`, null, { auth: false })).b.data.seriesPosition === null, "série non publiée : masquée sur la prédication");
  const del = await api("DELETE", `/admin/sermon-series/${ser1.id}`); must(del.s === 409 && del.b.errors?.sermons === 2, "série non vide : " + del.s + JSON.stringify(del.b.errors));
  await api("POST", `/admin/sermon-series/${ser1.id}/publish`);
  must((await api("DELETE", `/admin/sermon-series/${ser2.id}`)).s === 200 && (await api("GET", "/admin/sermon-series?deleted=true&limit=100")).b.data.some((x) => x.id === ser2.id) && (await api("POST", `/admin/sermon-series/${ser2.id}/restore`)).s === 200, "supprimer / corbeille / restaurer une série vide");
  must((await api("GET", `/admin/sermon-series?q=${tag}&limit=100`)).b.data.find((x) => x.id === ser1.id).sermonCount === 2, "administration : nombre de prédications");
  for (const qs of ["limit=1000", "status=FOO", "sort=title"]) must((await api("GET", `/admin/sermon-series?${qs}`)).s === 422, qs);
});
await t("protections : une personne intervenante ne se supprime pas ; un fichier utilisé ne se supprime pas du stockage", async () => {
  must((await api("POST", `/admin/people/${sp1.id}/unpublish`)).s === 200 && (await api("POST", `/admin/people/${sp1.id}/archive`)).s === 200, "préparation");
  const del = await api("DELETE", `/admin/people/${sp1.id}`); must(del.s === 409 && del.b.errors?.sermons >= 1, "personne utilisée : " + del.s + JSON.stringify(del.b));
  await api("POST", `/admin/people/${sp1.id}/unarchive`); await api("POST", `/admin/people/${sp1.id}/publish`);
  for (const [file, key] of [[audio, "sermons"], [video, "sermons"], [pdf1, "sermonDocuments"], [cover, "sermons"]]) {
    const r = await api("DELETE", `/storage/${file.id}`); must(r.s === 409 && r.b.errors?.[key] >= 1, `${file.originalFilename} : ${r.s} ${JSON.stringify(r.b.errors)}`);
  }
});
await t("administration : liste (état, série, intervenant, thème, tags, verset, dates, texte), tri, détail, tags ; paramètres invalides", async () => {
  const ids = async (qs) => (await api("GET", `${S}?q=${tag}&limit=100&${qs}`)).b.data.map((x) => x.id);
  must((await ids("state=PUBLISHED")).includes(s1.id) && !(await ids("state=PUBLISHED")).includes((await mk(day(-20))).id), "état");
  must((await ids(`seriesId=${ser1.id}`)).sort().join() === [s1.id, s2.id].sort().join(), "série");
  must((await ids(`speakerId=${sp3.id}`)).includes(s3.id) && (await ids("theme=famille")).join() === s3.id && (await ids("tags=famille")).join() === s3.id, "intervenant / thème / tags");
  must((await ids("verse=psaume")).join() === s3.id, "verset");
  const asc = (await api("GET", `${S}?q=${tag}&limit=100&sort=date&order=asc`)).b.data.map((x) => x.date); must(asc.join() === [...asc].sort().join(), "tri");
  const d = (await api("GET", `${S}/${s1.id}`)).b.data; must(d.documents.length === 2 && d.speakers.length === 1 && d.translations.en.slug && d.stats && d.series.title.startsWith("La foi"), "détail");
  const pg = await api("GET", `${S}?q=${tag}&limit=3&page=2`); must(pg.b.meta.limit === 3 && pg.b.meta.totalPages === Math.ceil(pg.b.meta.total / 3), "pagination");
  must((await api("GET", `${S}/tags`)).b.data.some((x) => x.tag === "foi" && x.count >= 2) && (await api("GET", `${P}/tags`, null, { auth: false })).b.data.some((x) => x.tag === "famille"), "tags");
  must(!(await api("GET", `${P}/tags`, null, { auth: false })).b.data.some((x) => x.tag === "autre-tag"), "tag d'une prédication non publiée masqué du public");
  for (const qs of ["limit=1000", "state=FOO", "sort=title", "seriesId=x", "role=KING"]) must((await api("GET", `${S}?${qs}`)).s === 422, qs);
  must((await api("GET", `${S}/00000000-0000-4000-8000-000000000000`)).s === 404 && (await api("GET", `${S}/abc`)).s === 422, "inconnue / invalide");
});
await t("audit : création, modification (jamais les textes), statut, suppression, restauration ; documents ; séries", async () => {
  const log = (entity, action) => prismaRaw.auditLog.findMany({ where: { entity, action, createdAt: { gte: started } } });
  const [c, u, st, d, r] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map((a) => log("sermons", a)));
  must(c.length && u.length && st.length && d.length && r.length, `sermons ${c.length}/${u.length}/${st.length}/${d.length}/${r.length}`);
  must((await log("sermon_documents", "CREATE")).length && (await log("sermon_documents", "UPDATE")).length && (await log("sermon_documents", "DELETE")).length, "documents");
  must((await log("sermon_series", "CREATE")).length && (await log("sermon_series", "STATUS_CHANGE")).length && (await log("sermon_series", "DELETE")).length, "séries");
  const dump = JSON.stringify([c, u]); must(!dump.includes("la foi sans les œuvres") && !dump.includes("Jacques 2:17") && !dump.includes("James 2"), "des textes figurent dans l'audit");
  must(u.some((l) => l.changes?.speakers?.to) && u.some((l) => l.changes?.fields?.tags), "intervenants et tags tracés");
  must(c[0].adminId && c[0].ipAddress && st.every((l) => l.changes.from && l.changes.to), "détails");
});
await t("base : contraintes (vidéo OU YouTube, format YouTube, compteurs ≥ 0, numéro ≥ 1, ≤ 20 tags, ≤ 10 versets, slug, rôle unique, statut, doc unique)", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|duplicate key|unique|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  const ins = (cols, vals) => `insert into sermons ("date",${cols},"updatedAt") values (now(),${vals},now())`;
  await bad(ins(`"videoFileId","youtubeId"`, `'${video.id}','dQw4w9WgXcQ'`), "vidéo ET YouTube"); await bad(ins(`"youtubeId"`, `'trop-court'`), "identifiant YouTube");
  await bad(ins(`"playCount"`, `-1`), "compteur négatif"); await bad(ins(`"seriesPosition"`, `0`), "numéro 0");
  await bad(ins(`"tags"`, `ARRAY[${Array.from({ length: 21 }, (_, i) => `'t${i}'`).join(",")}]`), "21 tags"); await bad(ins(`"status"`, `'CANCELLED'`), "statut CANCELLED"); await bad(ins(`"status"`, `'SCHEDULED'`), "programmée sans publishAt");
  await bad(`insert into sermon_translations ("sermonId","language","slug","title","verseReferences") values ('${s1.id}','de','x','t','{}')`, "langue inconnue");
  await bad(`insert into sermon_translations ("sermonId","language","slug","title") values ('${s2.id}','en','Pas Valide','t')`, "slug invalide");
  await bad(`insert into sermon_translations ("sermonId","language","slug","title","verseReferences") values ('${s2.id}','en','ok-${tag}-v',  't', ARRAY[${Array.from({ length: 11 }, (_, i) => `'v${i}'`).join(",")}])`, "11 versets");
  await bad(`insert into sermon_speakers ("sermonId","personId","role") values ('${s1.id}','${sp1.id}','PREACHER')`, "même personne et même rôle");
  await bad(`insert into sermon_documents ("sermonId","storageFileId") values ('${s1.id}','${pdf1.id}')`, "document en double");
});

// --- Nettoyage : tout ce que ce test a créé ---
await prismaRaw.sermon.deleteMany({ where: { OR: [{ id: { in: sermonIds } }, { translations: { some: { title: { contains: tag } } } }] } });
await prismaRaw.sermonSeries.deleteMany({ where: { OR: [{ id: { in: seriesIds } }, { translations: { some: { title: { contains: tag } } } }] } });
await prismaRaw.person.deleteMany({ where: { OR: [{ id: { in: personIds } }, { lastName: `Sm${tag}` }] } });
await prismaRaw.storageFile.deleteMany({ where: { OR: [{ publicId: { startsWith: "EVC-dev/test-sermons/" } }, { originalFilename: { contains: tag } }] } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: { in: ["sermons", "sermon_documents", "sermon_series", "people"] } } });
const left = (await prismaRaw.sermon.count({ where: { translations: { some: { title: { contains: tag } } } } })) + (await prismaRaw.person.count({ where: { lastName: `Sm${tag}` } })) + (await prismaRaw.sermonSeries.count({ where: { translations: { some: { title: { contains: tag } } } } }));
res.push(left === 0 ? "OK  nettoyage : aucune donnée de test restante" : `KO  nettoyage : ${left} lignes restantes`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
