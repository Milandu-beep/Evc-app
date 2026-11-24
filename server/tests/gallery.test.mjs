import "./helpers/safety.mjs";
// Test d'intégration de la Galerie : API HTTP réelle (dont l'import multiple en multipart) + vraie base.
// Le stockage utilise un FAUX fournisseur (aucun appel à Cloudinary). Utilise le compte SEED_ADMIN_* ;
// supprime tout ce qu'il crée.   Lancer : npm run test:gallery
import "dotenv/config";
import sharp from "sharp";
import { readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { default: CloudinaryProvider } = await import("../src/services/storage/providers/cloudinary.provider.js");

// --- Faux fournisseur : pas de réseau, durée fixe pour les vidéos ---
CloudinaryProvider.prototype.put = async function ({ publicId, resourceType, bytes }) {
  return { publicId, url: "http://stub/" + publicId, secureUrl: "https://stub/" + publicId, bytes, duration: resourceType === "VIDEO" ? 12.5 : undefined };
};
CloudinaryProvider.prototype.destroy = async () => true;
CloudinaryProvider.prototype.urlFor = function (f, o = {}) { return `https://stub/${o.thumbnail ? "thumb/" : ""}${f.publicId}`; };

const started = new Date();
const tag = randomBytes(3).toString("hex");
const server = app.listen(3122);
const base = "http://localhost:3122/api";
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
async function importFiles(albumId, files, fields = {}) {
  const fd = new FormData();
  for (const [name, buf] of files) fd.append("files", new Blob([buf]), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${base}/admin/gallery/albums/${albumId}/import`, { method: "POST", headers: { authorization: "Bearer " + token }, body: fd });
  return { s: r.status, b: await r.json() };
}
const tmpFiles = () => readdirSync(new URL("../src/uploads/tmp/", import.meta.url)).filter((f) => f !== ".gitkeep");
const A = "/admin/gallery";
const G = "/gallery";
const D = 24 * 3600e3;
const dayStr = (n) => new Date(Date.now() + n * D).toISOString().slice(0, 10);
const albumIds = [];
const mkAlbum = async (title, over = {}, extra = {}) => {
  const r = await api("POST", `${A}/albums`, { translations: { fr: { title: `${title} ${tag}`, ...extra.fr }, ...(extra.en && { en: extra.en }) }, ...over });
  if (r.s !== 201) throw new Error("création album " + r.s + JSON.stringify(r.b));
  albumIds.push(r.b.data.id);
  return r.b.data;
};
const png = (i) => sharp({ create: { width: 40 + i, height: 30 + i, channels: 3, background: { r: (i * 37) % 255, g: (i * 91) % 255, b: (i * 53 + tag.charCodeAt(0)) % 255 } } }).png().toBuffer();
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.from([0, 0, 0, 0]), Buffer.from("mp42isom"), randomBytes(400)]);
const exe = Buffer.concat([Buffer.from("MZ"), randomBytes(200)]);
const mkFile = (over = {}) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test-gallery/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "gallery", originalFilename: `gal-${tag}.jpg`, mimeType: "image/jpeg", bytes: 1, width: 640, height: 480, checksum: randomBytes(32).toString("hex"), ...over } });

const covFile = await mkFile({ originalFilename: `gal-${tag}-cover.jpg` });
const pdfFile = await mkFile({ resourceType: "RAW", mimeType: "application/pdf", originalFilename: `gal-${tag}.pdf` });
const audioFile = await mkFile({ resourceType: "VIDEO", mimeType: "audio/mpeg", originalFilename: `gal-${tag}.mp3` });
const extra = await mkFile({ originalFilename: `gal-${tag}-extra.jpg` });
const evPub = await prismaRaw.event.create({ data: { status: "PUBLISHED", publishedAt: new Date(), startsAt: new Date(Date.now() + 5 * D), translations: { create: [{ language: "fr", slug: `gal-ev-${tag}`, title: "Soirée de louange", description: "d" }, { language: "en", slug: `gal-ev-en-${tag}`, title: "Praise night", description: "d" }] } } });
const evDraft = await prismaRaw.event.create({ data: { status: "DRAFT", startsAt: new Date(Date.now() + 6 * D), translations: { create: [{ language: "fr", slug: `gal-draft-${tag}`, title: "Brouillon", description: "d" }] } } });

await t("sécurité : 401 sans token (admin, import) ; lecture publique libre", async () => {
  must((await api("GET", `${A}/albums`, null, { auth: false })).s === 401 && (await api("POST", `${A}/albums`, {}, { auth: false })).s === 401, "admin");
  must((await api("POST", `${A}/albums/00000000-0000-4000-8000-000000000000/import`, null, { auth: false })).s === 401, "import");
  for (const p of ["/albums", "/items", "/tags", "/home"]) must((await api("GET", G + p, null, { auth: false })).s === 200, p);
});
await t("validation des albums : titre, langue, date, ordre, couverture, événement -> 422", async () => {
  const bad = async (body, label) => must((await api("POST", `${A}/albums`, body)).s === 422, label);
  const fr = { title: "Titre valide" };
  await bad({ translations: {} }, "sans fr"); await bad({ translations: { en: fr } }, "en seul"); await bad({ translations: { fr, de: fr } }, "langue de");
  await bad({ translations: { fr: { title: "ab" } } }, "titre court"); await bad({ translations: { fr: { ...fr, description: "x".repeat(2001) } } }, "description");
  await bad({ date: "2031-02-30", translations: { fr } }, "date"); await bad({ sortOrder: -1, translations: { fr } }, "ordre négatif");
  await bad({ linkedEventId: "pas-un-uuid", translations: { fr } }, "uuid"); await bad({ linkedEventId: "00000000-0000-4000-8000-000000000000", translations: { fr } }, "événement inconnu");
  await bad({ coverImageId: pdfFile.id, translations: { fr } }, "couverture PDF"); await bad({ isFeatured: "oui", translations: { fr } }, "booléen");
});
let a1, a2;
await t("création : brouillon, slug généré, date du jour par défaut, ordre automatique, slugs uniques", async () => {
  a1 = await mkAlbum("Baptême de l'année", { isFeatured: false }, { fr: { description: "Photos du baptême." }, en: { title: `Baptism of the year ${tag}` } });
  must(a1.status === "DRAFT" && a1.itemCount === 0 && a1.cover === null && a1.date === dayStr(0) || a1.date === new Date().toISOString().slice(0, 10), JSON.stringify([a1.status, a1.date]));
  must(a1.translations.fr.slug.startsWith("bapteme-de-l-annee-") && a1.translations.en.slug.startsWith("baptism-of-the-year-"), a1.translations.fr.slug);
  a2 = await mkAlbum("Baptême de l'année", { date: dayStr(-30) }, {});
  must(a2.translations.fr.slug === a1.translations.fr.slug + "-2", "doublon : " + a2.translations.fr.slug);
  must(a2.sortOrder === a1.sortOrder + 1, `ordre automatique ${a1.sortOrder}/${a2.sortOrder}`);
  must((await api("POST", `${A}/albums`, { translations: { fr: { title: "Autre", slug: a1.translations.fr.slug } } })).s === 409, "slug explicite en conflit");
});
let imported;
await t("IMPORT MULTIPLE : photos + vidéo, tags normalisés, ordre d'envoi, doublon et fichier refusé signalés", async () => {
  const [p0, p1, p2] = [await png(0), await png(1), await png(2)];
  const r = await importFiles(a1.id, [[`gal-${tag}-1.png`, p0], [`gal-${tag}-2.png`, p1], [`gal-${tag}-vidéo.mp4`, mp4()], [`gal-${tag}-3.png`, p2], [`gal-${tag}-copie.png`, p0], [`gal-${tag}-virus.png`, exe]], { tags: "Baptême 2026, Jeunesse, jeunesse" });
  must(r.s === 201, r.s + JSON.stringify(r.b).slice(0, 300));
  const d = r.b.data;
  must(d.created.length === 4 && d.skipped.length === 1 && d.failed.length === 1, `créés ${d.created.length} ignorés ${d.skipped.length} refusés ${d.failed.length}`);
  must(d.skipped[0].reason === "Déjà dans l'album" && d.failed[0].status === 415 && d.failed[0].originalFilename.includes("virus"), JSON.stringify([d.skipped, d.failed]));
  must(d.created.map((i) => i.position).join() === "0,1,2,3" && d.created.map((i) => i.type).join() === "PHOTO,PHOTO,VIDEO,PHOTO", "ordre / types : " + d.created.map((i) => i.type + i.position));
  must(d.created.every((i) => i.tags.join() === "bapteme-2026,jeunesse"), "tags : " + JSON.stringify(d.created[0].tags));
  const video = d.created.find((i) => i.type === "VIDEO");
  must(video.file.duration === 12.5 && video.file.thumbnailUrl && video.file.url.startsWith("https://"), "vidéo : durée et miniature " + JSON.stringify(video.file));
  must(d.created[0].file.width === 40 && d.created[0].file.originalFilename === `gal-${tag}-1.png`, "fichier");
  must(tmpFiles().length === 0, "fichiers temporaires restants : " + tmpFiles());
  imported = d.created;
});
await t("import : sans fichier -> 422 ; que des refus -> 422 ; album inconnu -> 404 ; 21 fichiers -> 4xx ; aucun temporaire", async () => {
  must((await importFiles(a1.id, [], {})).s === 422, "sans fichier");
  must((await importFiles(a1.id, [[`gal-${tag}-x.png`, exe]], {})).s === 422, "tout refusé");
  must((await importFiles("00000000-0000-4000-8000-000000000000", [[`gal-${tag}-y.png`, await png(5)]], {})).s === 404, "album inconnu");
  const many = []; for (let i = 0; i < 21; i++) many.push([`gal-${tag}-m${i}.png`, await png(10 + i)]);
  const r = await importFiles(a1.id, many, {}); must(r.s === 400, "21 fichiers : " + r.s);
  must((await importFiles(a1.id, [[`gal-${tag}-t.png`, await png(40)]], { tags: Array.from({ length: 41 }, (_, i) => "t" + i).join(",") })).s === 422, "41 tags");
  must(tmpFiles().length === 0, "temporaires : " + tmpFiles());
  must((await api("GET", `${A}/albums/${a1.id}/items`)).b.meta.total === 4, "l'album ne doit pas avoir changé");
});
await t("rattachement de fichiers déjà envoyés : photo OK ; PDF, audio, inconnu refusés ; doublon ignoré", async () => {
  const r = await api("POST", `${A}/albums/${a2.id}/items`, { storageFileIds: [extra.id, pdfFile.id, audioFile.id, "00000000-0000-4000-8000-000000000000", extra.id], tags: ["Été"] });
  must(r.s === 201 && r.b.data.created.length === 1 && r.b.data.failed.length === 3 && r.b.data.created[0].tags.join() === "ete", JSON.stringify(r.b).slice(0, 300));
  const again = await api("POST", `${A}/albums/${a2.id}/items`, { storageFileIds: [extra.id] });
  must(again.b.data.created.length === 0 && again.b.data.skipped.length === 1, "doublon");
  must((await api("POST", `${A}/albums/${a2.id}/items`, { storageFileIds: [] })).s === 422 && (await api("POST", `${A}/albums/${a2.id}/items`, { storageFileIds: ["x"] })).s === 422, "validation");
});
await t("un média : tags remplacés/normalisés, titre + description + texte alternatif FR/EN, effaçables ; 21 tags -> 422", async () => {
  const it = imported[0];
  let r = await api("PATCH", `${A}/items/${it.id}`, { tags: ["Louange", "LOUANGE", " Adoration  nocturne ", "été"], translations: { fr: { title: "Le baptême", description: "Dans le fleuve.", altText: "Un pasteur baptise un jeune homme" }, en: { altText: "A pastor baptizes a young man" } } });
  must(r.s === 200 && r.b.data.tags.join() === "louange,adoration-nocturne,ete", JSON.stringify(r.b).slice(0, 250));
  must(r.b.data.translations.fr.altText.startsWith("Un pasteur") && r.b.data.translations.en.altText.startsWith("A pastor") && r.b.data.translations.en.title === null, "textes");
  r = await api("PATCH", `${A}/items/${it.id}`, { translations: { fr: { description: null }, en: null } });
  must(r.b.data.translations.fr.description === null && !r.b.data.translations.en && r.b.data.translations.fr.title === "Le baptême", "effacer");
  r = await api("PATCH", `${A}/items/${it.id}`, { tags: [] }); must(r.b.data.tags.length === 0, "tags vidés");
  must((await api("PATCH", `${A}/items/${it.id}`, { tags: Array.from({ length: 21 }, (_, i) => "tag" + i) })).s === 422, "21 tags");
  must((await api("PATCH", `${A}/items/${it.id}`, { translations: { fr: { altText: "x".repeat(251) } } })).s === 422, "alt trop long");
  r = await api("PATCH", `${A}/items/${imported[1].id}`, { translations: { en: { title: null } } }); must(r.s === 200 && !r.b.data.translations.en, "traduction vide non créée");
  must((await api("PATCH", `${A}/items/00000000-0000-4000-8000-000000000000`, { tags: [] })).s === 404, "inconnu");
  await api("PATCH", `${A}/items/${it.id}`, { tags: ["louange", "bapteme-2026"] });
});
await t("réorganisation : liste exacte requise ; périmée / doublon / inconnue refusées ; ordre appliqué", async () => {
  const cur = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data.map((i) => i.id);
  const reversed = [...cur].reverse();
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: reversed })).s === 200, "réorganiser");
  const after = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data;
  must(after.map((i) => i.id).join() === reversed.join() && after.map((i) => i.position).join() === "0,1,2,3", "ordre appliqué");
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: reversed.slice(1) })).s === 409, "liste incomplète");
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: [...reversed, extra.id] })).s === 409, "identifiant étranger à l'album : liste périmée");
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: ["pas-un-uuid"] })).s === 422, "id non UUID");
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: [reversed[0], reversed[0], reversed[1], reversed[2]] })).s === 422, "doublons");
  must((await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: [] })).s === 422, "vide");
  await api("PUT", `${A}/albums/${a1.id}/items/order`, { itemIds: cur });
  imported = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data;
});
let a3;
await t("déplacement entre albums : ajouté à la fin, tags et textes conservés ; doublon, même album, archivé, inconnu gérés", async () => {
  a3 = await mkAlbum("Album de destination");
  const [first, second] = imported;
  await api("PATCH", `${A}/items/${first.id}`, { translations: { fr: { title: "À déplacer" } } });
  let r = await api("POST", `${A}/items/move`, { itemIds: [second.id, first.id], toAlbumId: a3.id });
  must(r.s === 200 && r.b.data.moved.join() === `${second.id},${first.id}` && r.b.data.skipped.length === 0, JSON.stringify(r.b).slice(0, 250));
  const dest = (await api("GET", `${A}/albums/${a3.id}/items`)).b.data;
  must(dest.map((i) => i.id).join() === `${second.id},${first.id}` && dest.map((i) => i.position).join() === "0,1", "ordre dans la cible");
  must(dest[1].tags.join() === "louange,bapteme-2026" && dest[1].translations.fr.title === "À déplacer" && dest[1].albumId === a3.id, "tags / textes conservés");
  must((await api("GET", `${A}/albums/${a1.id}/items`)).b.meta.total === 2, "source allégée");
  r = await api("POST", `${A}/items/move`, { itemIds: [first.id], toAlbumId: a3.id }); must(r.b.data.skipped[0]?.reason === "Déjà dans cet album", "même album");
  await api("POST", `${A}/albums/${a2.id}/items`, { storageFileIds: [covFile.id] });
  const twin = (await api("POST", `${A}/albums/${a3.id}/items`, { storageFileIds: [covFile.id] })).b.data.created[0];
  r = await api("POST", `${A}/items/move`, { itemIds: [(await api("GET", `${A}/albums/${a2.id}/items`)).b.data.find((i) => i.file.id === covFile.id).id], toAlbumId: a3.id });
  must(r.b.data.moved.length === 0 && r.b.data.skipped[0].reason.includes("déjà"), "même fichier dans la cible : " + JSON.stringify(r.b.data));
  await api("DELETE", `${A}/items/${twin.id}`);
  const arch = await mkAlbum("Archivé"); await api("POST", `${A}/albums/${arch.id}/archive`);
  must((await api("POST", `${A}/items/move`, { itemIds: [first.id], toAlbumId: arch.id })).s === 409, "cible archivée");
  must((await api("POST", `${A}/items/move`, { itemIds: ["00000000-0000-4000-8000-000000000000"], toAlbumId: a3.id })).s === 422, "média inconnu");
  must((await api("POST", `${A}/items/move`, { itemIds: [first.id], toAlbumId: "00000000-0000-4000-8000-000000000000" })).s === 404, "album inconnu");
  await api("POST", `${A}/items/move`, { itemIds: [second.id, first.id], toAlbumId: a1.id }); // on remet les médias dans a1
  imported = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data;
});
await t("suppression logique d'un média : masqué (admin + public), corbeille, restauration à la fin ; albums en corbeille / doublon -> 409", async () => {
  const victim = imported[0];
  must((await api("DELETE", `${A}/items/${victim.id}`)).s === 200, "supprimer");
  must(!(await api("GET", `${A}/albums/${a1.id}/items`)).b.data.some((i) => i.id === victim.id), "encore listé");
  must((await api("GET", `${A}/albums/${a1.id}/items?deleted=true`)).b.data.some((i) => i.id === victim.id), "absent de la corbeille");
  must((await api("DELETE", `${A}/items/${victim.id}`)).s === 404, "supprimer deux fois");
  must((await api("PATCH", `${A}/items/${victim.id}`, { tags: [] })).s === 404, "modifier un supprimé");
  const r = await api("POST", `${A}/items/${victim.id}/restore`);
  const items = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data;
  must(r.s === 200 && items.at(-1).id === victim.id && r.b.data.tags.join() === victim.tags.join(), "restauré en fin d'album avec ses tags : " + JSON.stringify([r.s, items.at(-1).id === victim.id, r.b.data?.tags, victim.tags]));
  must((await api("POST", `${A}/items/${victim.id}/restore`)).s === 404, "restaurer un actif");
  // doublon : on supprime puis on rattache de nouveau le même fichier -> la restauration est refusée
  await api("DELETE", `${A}/items/${victim.id}`);
  await api("POST", `${A}/albums/${a1.id}/items`, { storageFileIds: [victim.file.id] });
  must((await api("POST", `${A}/items/${victim.id}/restore`)).s === 409, "doublon à la restauration");
  must((await api("POST", `${A}/albums/00000000-0000-4000-8000-000000000000/items`, { storageFileIds: [extra.id] })).s === 404, "album inconnu");
  imported = (await api("GET", `${A}/albums/${a1.id}/items`)).b.data;
});
await t("cycle de vie d'un album : publication refusée si vide ; transitions ; archivé non modifiable ; suppression/restauration", async () => {
  const empty = await mkAlbum("Album vide");
  must((await api("POST", `${A}/albums/${empty.id}/publish`)).s === 422, "publier un album vide");
  must((await api("POST", `${A}/albums/${empty.id}/unpublish`)).s === 409 && (await api("POST", `${A}/albums/${empty.id}/unarchive`)).s === 409, "invalides");
  must((await api("POST", `${A}/albums/${a1.id}/publish`)).b.data.status === "PUBLISHED", "publier");
  must((await api("POST", `${A}/albums/${a1.id}/publish`)).s === 409, "publier deux fois");
  const c = await mkAlbum("Concurrence"); await api("POST", `${A}/albums/${c.id}/items`, { storageFileIds: [extra.id] });
  const codes = (await Promise.all([api("POST", `${A}/albums/${c.id}/publish`), api("POST", `${A}/albums/${c.id}/publish`)])).map((r) => r.s).sort();
  must(codes[0] === 200 && codes[1] === 409, "simultané " + codes);
  must((await api("DELETE", `${A}/albums/${c.id}`)).s === 409, "supprimer un publié");
  await api("POST", `${A}/albums/${c.id}/unpublish`);
  must((await api("POST", `${A}/albums/${empty.id}/archive`)).b.data.status === "ARCHIVED" && (await api("PATCH", `${A}/albums/${empty.id}`, { isFeatured: true })).s === 409, "archivé non modifiable");
  must((await api("POST", `${A}/albums/${empty.id}/unarchive`)).b.data.status === "DRAFT", "désarchiver");
  must((await api("POST", `${A}/albums/${a1.id}/items`, { storageFileIds: [extra.id] })).s === 201, "ajout à un album publié");
  must((await api("DELETE", `${A}/albums/${c.id}`)).s === 200, "supprimer un brouillon");
  must((await api("GET", `${A}/albums?deleted=true&limit=100`)).b.data.some((x) => x.id === c.id), "corbeille");
  must((await api("POST", `${A}/albums/${c.id}/items`, { storageFileIds: [extra.id] })).s === 404, "ajouter à un album supprimé");
  const item = (await api("GET", `${A}/albums/${c.id}/items`)).b.data[0];
  await api("DELETE", `${A}/items/${item.id}`); // média supprimé dans un album en corbeille
  must((await api("POST", `${A}/items/${item.id}/restore`)).s === 409, "restaurer un média dont l'album est en corbeille");
  const r = await api("POST", `${A}/albums/${c.id}/restore`); must(r.s === 200 && r.b.data.status === "DRAFT", "restaurer l'album");
  must((await api("POST", `${A}/items/${item.id}/restore`)).s === 200, "puis le média");
  must((await api("POST", `${A}/albums/${c.id}/restore`)).s === 404, "restaurer un actif");
  await api("DELETE", `${A}/albums/${c.id}`);
});
await t("couverture : explicite, effaçable (null), automatique (premier média) ; image prête requise", async () => {
  let r = await api("PATCH", `${A}/albums/${a1.id}`, { coverImageId: covFile.id });
  must(r.s === 200 && r.b.data.coverImage?.id === covFile.id && r.b.data.cover?.url.includes(covFile.publicId.split("/").pop()), "couverture choisie");
  r = await api("PATCH", `${A}/albums/${a1.id}`, { coverImageId: null });
  must(r.s === 200 && r.b.data.coverImage === null && r.b.data.cover?.url, "automatique après effacement : " + JSON.stringify(r.b.data.cover));
  must((await api("PATCH", `${A}/albums/${a1.id}`, { coverImageId: audioFile.id })).s === 422, "audio refusé");
});
await t("événement lié : lien affiché seulement si l'événement est public ; GET /events/:slug/albums", async () => {
  let r = await api("PATCH", `${A}/albums/${a1.id}`, { linkedEventId: evDraft.id });
  must(r.s === 200 && r.b.data.linkedEvent?.id === evDraft.id, "lien enregistré");
  must((await api("GET", `${G}/albums/${a1.albumSlug ?? a1.translations.fr.slug}`, null, { auth: false })).b.data.linkedEvent === null, "événement brouillon : lien masqué");
  await api("PATCH", `${A}/albums/${a1.id}`, { linkedEventId: evPub.id });
  const pub = (await api("GET", `${G}/albums/${a1.translations.fr.slug}`, null, { auth: false })).b.data;
  must(pub.linkedEvent?.slug === `gal-ev-${tag}` && pub.linkedEvent.title === "Soirée de louange", JSON.stringify(pub.linkedEvent));
  const en = (await api("GET", `${G}/albums/${a1.translations.en.slug}?lang=en`, null, { auth: false })).b.data;
  must(en.linkedEvent?.slug === `gal-ev-en-${tag}` && en.linkedEvent.title === "Praise night", "événement lié en anglais");
  const viaEvent = await api("GET", `/events/gal-ev-${tag}/albums`, null, { auth: false });
  must(viaEvent.s === 200 && viaEvent.b.data.albums.map((a) => a.id).join() === a1.id && viaEvent.b.data.event.slug === `gal-ev-${tag}`, JSON.stringify(viaEvent.b).slice(0, 250));
  must((await api("GET", `/events/gal-ev-en-${tag}/albums?lang=en`, null, { auth: false })).b.data.albums[0].language === "en", "langue");
  must((await api("GET", `/events/gal-draft-${tag}/albums`, null, { auth: false })).s === 404 && (await api("GET", `/events/inconnu-${tag}/albums`, null, { auth: false })).s === 404, "événement non public / inconnu");
  must((await api("GET", `${G}/albums?eventId=${evPub.id}`, null, { auth: false })).b.data.map((a) => a.id).join() === a1.id, "filtre eventId");
  r = await api("PATCH", `${A}/albums/${a1.id}`, { linkedEventId: null }); must(r.b.data.linkedEvent === null, "délier");
  must((await api("GET", `/events/gal-ev-${tag}/albums`, null, { auth: false })).b.data.albums.length === 0, "plus d'album");
  await api("PATCH", `${A}/albums/${a1.id}`, { linkedEventId: evPub.id });
});
await t("lecture publique d'un album : médias ordonnés et paginés, filtres tags/type, langue, texte alternatif de repli, aucun champ interne", async () => {
  await api("PATCH", `${A}/items/${imported[0].id}`, { tags: ["louange"], translations: { fr: { title: "Titre seul", altText: null } } });
  const r = await api("GET", `${G}/albums/${a1.translations.fr.slug}`, null, { auth: false });
  const d = r.b.data;
  must(r.s === 200 && r.h.get("cache-control") === "public, max-age=60" && d.itemCount === d.items.length && r.b.meta.total === d.itemCount, "détail " + r.s);
  must(d.items.map((i) => i.position).every((p, i, a) => i === 0 || a[i - 1] <= p), "ordre");
  const withTitle = d.items.find((i) => i.title === "Titre seul"); must(withTitle.altText === "Titre seul", "alt -> titre");
  const bare = d.items.find((i) => !i.title); must(bare.altText === `Baptême de l'année ${tag}`, "alt -> titre de l'album : " + bare?.altText);
  for (const k of ["status", "createdById", "deletedAt", "storageFile", "translations"]) must(!d.items.some((i) => k in i) && !(k in d), "champ interne : " + k);
  must(d.items.some((i) => i.type === "VIDEO" && i.duration === 12.5 && i.thumbnailUrl), "vidéo");
  must((await api("GET", `${G}/albums/${a1.translations.fr.slug}?type=VIDEO`, null, { auth: false })).b.data.items.every((i) => i.type === "VIDEO"), "filtre type");
  must((await api("GET", `${G}/albums/${a1.translations.fr.slug}?tags=louange`, null, { auth: false })).b.data.items.every((i) => i.tags.includes("louange")), "filtre tag");
  const p2 = await api("GET", `${G}/albums/${a1.translations.fr.slug}?limit=2&page=2`, null, { auth: false }); must(p2.b.data.items.length === Math.min(2, d.itemCount - 2) && p2.b.meta.totalPages === Math.ceil(d.itemCount / 2), "pagination");
  must((await api("GET", `${G}/albums/${a1.translations.fr.slug}?lang=en`, null, { auth: false })).s === 404, "slug fr dans la langue en");
  must((await api("GET", `${G}/albums/${a1.translations.en.slug}?lang=en`, null, { auth: false })).b.data.language === "en", "slug en");
  must((await api("GET", `${G}/albums/${a2.translations.fr.slug}`, null, { auth: false })).s === 404, "brouillon visible !");
  must((await api("GET", `${G}/albums/${a1.translations.fr.slug}?limit=1000`, null, { auth: false })).s === 422 && (await api("GET", `${G}/albums/x?match=maybe`, null, { auth: false })).s === 422, "paramètres invalides");
});
await t("liste publique des albums : publiés seulement, récents / ordre manuel, mise en avant, dates, langue, aucun champ interne", async () => {
  await api("POST", `${A}/albums/${a2.id}/publish`);
  await api("POST", `${A}/albums/${a3.id}/items`, { storageFileIds: [extra.id] }); await api("POST", `${A}/albums/${a3.id}/publish`);
  const all = await api("GET", `${G}/albums?limit=100`, null, { auth: false });
  const mine = all.b.data.filter((a) => [a1.id, a2.id, a3.id].includes(a.id));
  must(mine.length === 3 && all.b.data.every((a) => a.title), "publiés");
  const dates = all.b.data.map((a) => a.date); must(dates.join() === [...dates].sort().reverse().join(), "récents d'abord");
  must(mine.find((a) => a.id === a1.id).cover?.url && mine.find((a) => a.id === a1.id).itemCount >= 3, "couverture et nombre de médias");
  for (const k of ["status", "sortOrder", "createdById", "deletedAt", "publishedAt", "translations"]) must(!(k in all.b.data[0]), "champ interne : " + k);
  await api("PATCH", `${A}/albums/${a2.id}`, { isFeatured: true });
  must((await api("GET", `${G}/albums?featured=true&limit=100`, null, { auth: false })).b.data.filter((a) => [a1.id, a2.id, a3.id].includes(a.id)).map((a) => a.id).join() === a2.id, "mis en avant");
  must((await api("GET", `${G}/albums?from=${dayStr(-40)}&to=${dayStr(-20)}&limit=100`, null, { auth: false })).b.data.some((a) => a.id === a2.id), "plage de dates");
  must((await api("GET", `${G}/albums?lang=en&limit=100`, null, { auth: false })).b.data.find((a) => a.id === a1.id).language === "en", "langue en");
  const p = await api("GET", `${G}/albums?limit=1&page=2`, null, { auth: false }); must(p.b.meta.limit === 1 && p.b.meta.totalPages === p.b.meta.total, "pagination");
  must((await api("GET", `${G}/albums?sort=nope`, null, { auth: false })).s === 422 && (await api("GET", `${G}/albums?from=x`, null, { auth: false })).s === 422 && (await api("GET", `${G}/albums?eventId=x`, null, { auth: false })).s === 422, "invalides");
});
await t("ordre manuel des albums : liste exacte requise (409 si périmée) ; sort=manual et accueil le reflètent", async () => {
  const lst = (await api("GET", `${A}/albums?limit=100&sort=sortOrder&order=asc`)).b.data.map((a) => a.id);
  const rotated = [...lst.slice(1), lst[0]];
  must((await api("PUT", `${A}/albums/order`, { ids: rotated })).s === 200, "réorganiser");
  must((await api("PUT", `${A}/albums/order`, { ids: rotated.slice(1) })).s === 409, "liste périmée");
  must((await api("PUT", `${A}/albums/order`, { ids: [...rotated, rotated[0]] })).s === 422, "doublon");
  must((await api("GET", `${A}/albums?limit=100&sort=sortOrder&order=asc`)).b.data.map((a) => a.sortOrder).join() === lst.map((_, i) => i).join(), "sortOrder 0..n-1");
  const manual = (await api("GET", `${G}/albums?sort=manual&limit=100`, null, { auth: false })).b.data.map((a) => a.id);
  const order = rotated.filter((id) => manual.includes(id)); must(manual.join() === order.join(), "sort=manual");
  const home = await api("GET", `${G}/home?limit=2`, null, { auth: false });
  must(home.s === 200 && home.b.data.recent.length <= 2 && home.b.data.featured.every((a) => a.isFeatured) && home.b.data.featured.some((a) => a.id === a2.id), "accueil");
  must((await api("GET", `${G}/home?limit=99`, null, { auth: false })).s === 422, "limit invalide");
});
await t("recherche transversale : tags (tous / au moins un), texte (titre, description, alt, tag), type, album, événement ; accent-insensible pour les tags", async () => {
  await api("PATCH", `${A}/items/${imported[1].id}`, { tags: ["louange", "unique-" + tag], translations: { fr: { description: `Moment de recueillement ${tag}`, altText: `Foule ${tag}` } } });
  const it = (qs) => api("GET", `${G}/items?${qs}&limit=100`, null, { auth: false });
  must((await it(`tags=unique-${tag}`)).b.data.length === 1, "tag unique");
  const both = await it(`tags=louange,unique-${tag}`); must(both.b.data.length === 1, "tous les tags : " + both.b.data.length);
  must((await it(`tags=louange,unique-${tag}&match=any`)).b.data.length >= 2, "au moins un tag");
  must((await it(`tags=${encodeURIComponent("UNIQUE " + tag)}`)).b.data.length === 1, "tag saisi avec majuscules et espace");
  must((await it(`q=recueillement`)).b.data.some((x) => x.description?.includes(tag)), "texte (description)");
  must((await it(`q=${encodeURIComponent("Foule " + tag)}`)).b.data.length === 1, "texte (alt)");
  must((await it(`q=unique-${tag}`)).b.data.length === 1, "q = tag");
  must((await it("type=VIDEO")).b.data.every((x) => x.type === "VIDEO") && (await it("type=PHOTO")).b.data.every((x) => x.type === "PHOTO"), "type");
  must((await it(`albumId=${a1.id}`)).b.data.every((x) => x.album.id === a1.id), "album");
  must((await it(`eventId=${evPub.id}`)).b.data.every((x) => x.album.id === a1.id) && (await it(`eventId=${evPub.id}`)).b.data.length >= 3, "événement");
  const one = (await it(`tags=unique-${tag}`)).b.data[0];
  must(one.album.slug && one.album.title && one.url && one.thumbnailUrl && one.altText, "item avec album : " + JSON.stringify(one).slice(0, 200));
  must(!(await it(`q=${encodeURIComponent("'; DROP TABLE gallery_items;--")}`)).b.data.length, "injection");
  const p = await api("GET", `${G}/items?limit=2&page=2`, null, { auth: false }); must(p.b.meta.limit === 2 && p.b.data.length <= 2, "pagination");
  must((await it("type=GIF")).s === 422 && (await api("GET", `${G}/items?tags=${"x".repeat(401)}`, null, { auth: false })).s === 422, "invalides");
});
await t("albums par tag et recherche : un album ressort si l'un de ses médias correspond ; brouillons exclus", async () => {
  const r = await api("GET", `${G}/albums?tags=unique-${tag}`, null, { auth: false }); must(r.b.data.map((a) => a.id).join() === a1.id, "tag");
  must((await api("GET", `${G}/albums?q=${encodeURIComponent("Foule " + tag)}`, null, { auth: false })).b.data.map((a) => a.id).join() === a1.id, "recherche dans les médias");
  must((await api("GET", `${G}/albums?q=${encodeURIComponent("Baptism of the year")}`, null, { auth: false })).b.data.some((a) => a.id === a1.id), "recherche dans la traduction anglaise");
  await api("POST", `${A}/albums/${a3.id}/unpublish`);
  must(!(await api("GET", `${G}/items?albumId=${a3.id}`, null, { auth: false })).b.data.length, "médias d'un album dépublié invisibles");
  await api("POST", `${A}/albums/${a3.id}/publish`);
});
await t("tags : liste publique (albums publiés) et d'administration avec compteurs", async () => {
  const pub = (await api("GET", `${G}/tags`, null, { auth: false })).b.data;
  const u = pub.find((x) => x.tag === `unique-${tag}`); must(u?.count === 1, "tag public");
  must(pub.find((x) => x.tag === "louange").count >= 2 && pub.every((x, i, a) => i === 0 || a[i - 1].count >= x.count), "tri par usage");
  await api("POST", `${A}/albums/${a1.id}/unpublish`);
  must(!(await api("GET", `${G}/tags`, null, { auth: false })).b.data.some((x) => x.tag === `unique-${tag}`), "tag d'un album dépublié masqué du public");
  must((await api("GET", `${A}/tags`)).b.data.some((x) => x.tag === `unique-${tag}`), "visible côté administration");
  await api("POST", `${A}/albums/${a1.id}/publish`);
});
await t("stockage : un fichier utilisé par la galerie ne peut pas être supprimé (409 avec le détail)", async () => {
  const used = imported[0].file.id;
  const r = await api("DELETE", `/storage/${used}`);
  must(r.s === 409 && r.b.errors?.galleryItems >= 1, r.s + JSON.stringify(r.b).slice(0, 200));
  await api("PATCH", `${A}/albums/${a1.id}`, { coverImageId: covFile.id });
  const c = await api("DELETE", `/storage/${covFile.id}`);
  must(c.s === 409 && c.b.errors?.galleryAlbums >= 1, "couverture d'album : " + c.s + JSON.stringify(c.b.errors));
  await api("PATCH", `${A}/albums/${a1.id}`, { coverImageId: null });
});
await t("administration : liste des albums (filtres statut, événement, dates, recherche, tri), détail, médias paginés ; paramètres invalides", async () => {
  const ids = async (qs) => (await api("GET", `${A}/albums?${qs}&limit=100`)).b.data.map((a) => a.id);
  must((await ids(`status=PUBLISHED&q=${tag}`)).includes(a1.id) && !(await ids(`status=DRAFT&q=${tag}`)).includes(a1.id), "statut");
  must((await ids(`eventId=${evPub.id}`)).join() === a1.id, "événement");
  must((await ids(`q=${encodeURIComponent("Baptism")}`)).includes(a1.id), "recherche");
  const sorted = (await api("GET", `${A}/albums?q=${tag}&sort=date&order=asc&limit=100`)).b.data.map((a) => a.date); must(sorted.join() === [...sorted].sort().join(), "tri");
  must((await api("GET", `${A}/albums?featured=true&q=${tag}`)).b.data.every((a) => a.isFeatured), "vedette");
  const d = (await api("GET", `${A}/albums/${a1.id}`)).b.data; must(d.itemCount >= 3 && d.linkedEvent?.title === "Soirée de louange" && d.translations.en && d.date, "détail");
  const pg = await api("GET", `${A}/albums/${a1.id}/items?limit=2&page=2`); must(pg.b.meta.limit === 2 && pg.b.data.length <= 2, "médias paginés");
  for (const qs of ["limit=1000", "status=FOO", "sort=title", "from=x", "eventId=x"]) must((await api("GET", `${A}/albums?${qs}`)).s === 422, qs);
  must((await api("GET", `${A}/albums/00000000-0000-4000-8000-000000000000`)).s === 404 && (await api("GET", `${A}/albums/abc`)).s === 422, "inconnu / invalide");
});
await t("audit : albums et médias (création, import, modification, déplacement, statut, suppression, restauration) sans texte", async () => {
  const log = (entity, action) => prismaRaw.auditLog.findMany({ where: { entity, action, createdAt: { gte: started } } });
  const [ac, au, as, ad, ar] = await Promise.all(["CREATE", "UPDATE", "STATUS_CHANGE", "DELETE", "RESTORE"].map((a) => log("gallery_albums", a)));
  const [ic, iu, id, ir, up] = await Promise.all([log("gallery_items", "CREATE"), log("gallery_items", "UPDATE"), log("gallery_items", "DELETE"), log("gallery_items", "RESTORE"), log("storage_files", "UPLOAD_FILE")]);
  must(ac.length && au.length && as.length && ad.length && ar.length, `albums ${ac.length}/${au.length}/${as.length}/${ad.length}/${ar.length}`);
  must(ic.length && iu.length && id.length && ir.length && up.length >= 4, `médias ${ic.length}/${iu.length}/${id.length}/${ir.length}/${up.length}`);
  must(ic.some((l) => l.changes?.count >= 4 && l.changes?.tags?.includes("bapteme-2026")), "import tracé (nombre, tags)");
  must(iu.some((l) => l.changes?.moved === 2) && au.some((l) => l.changes?.reordered), "déplacement et réorganisation tracés");
  const dump = JSON.stringify([ac, au, iu]); must(!dump.includes("Dans le fleuve") && !dump.includes("recueillement") && !dump.includes("pasteur baptise") && !dump.includes("Foule"), "des textes figurent dans l'audit");
  must(as.every((l) => l.changes.from && l.changes.to && l.changes.action) && ac[0].adminId && ac[0].ipAddress, "détails");
});
await t("base : contraintes (≤ 20 tags, position ≥ 0, fichier unique par album actif, slug valide, statut invalide)", async () => {
  const bad = async (sql, label) => { try { await prismaRaw.$executeRawUnsafe(sql); } catch (e) { if (/check constraint|duplicate key|unique|invalid input value for enum/i.test(e.message)) return; throw e; } throw new Error(label + " accepté"); };
  const it = imported[0];
  await bad(`insert into gallery_items ("albumId","storageFileId","type","position","tags","updatedAt") values ('${a1.id}','${it.file.id}','PHOTO',99,'{}',now())`, "doublon (album, fichier)");
  await bad(`insert into gallery_items ("albumId","storageFileId","type","position","tags","updatedAt") values ('${a3.id}','${covFile.id}','PHOTO',-1,'{}',now())`, "position négative");
  await bad(`insert into gallery_items ("albumId","storageFileId","type","position","tags","updatedAt") values ('${a3.id}','${covFile.id}','PHOTO',5,ARRAY[${Array.from({ length: 21 }, (_, i) => `'t${i}'`).join(",")}],now())`, "21 tags");
  await bad(`insert into gallery_items ("albumId","storageFileId","type","position","tags","updatedAt") values ('${a3.id}','${covFile.id}','AUDIO',5,'{}',now())`, "type AUDIO");
  await bad(`insert into gallery_album_translations ("albumId","language","slug","title") values ('${a3.id}','en','Pas Valide','t')`, "slug invalide");
  await bad(`insert into gallery_albums ("status","date","updatedAt") values ('SCHEDULED', now(), now())`, "statut SCHEDULED");
});

// --- Nettoyage : tout ce que ce test a créé ---
const fileIds = (await prismaRaw.storageFile.findMany({ where: { OR: [{ originalFilename: { startsWith: `gal-${tag}` } }, { publicId: { startsWith: "EVC-dev/test-gallery/" } }] }, select: { id: true } })).map((f) => f.id);
await prismaRaw.galleryAlbum.deleteMany({ where: { id: { in: albumIds } } }); // supprime aussi les médias (cascade)
await prismaRaw.galleryAlbum.deleteMany({ where: { createdAt: { gte: started }, translations: { some: { title: { contains: tag } } } } });
await prismaRaw.storageFile.deleteMany({ where: { id: { in: fileIds } } });
await prismaRaw.event.deleteMany({ where: { id: { in: [evPub.id, evDraft.id] } } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, OR: [{ entity: { in: ["gallery_albums", "gallery_items"] } }, { entity: "storage_files", action: { in: ["UPLOAD_FILE", "DELETE_FILE"] } }] } });
const left = (await prismaRaw.galleryAlbum.count({ where: { translations: { some: { title: { contains: tag } } } } })) + (await prismaRaw.storageFile.count({ where: { originalFilename: { startsWith: `gal-${tag}` } } }));
res.push(left === 0 && tmpFiles().length === 0 ? "OK  nettoyage : aucune donnée de test ni fichier temporaire restant" : `KO  nettoyage : ${left} lignes restantes, temporaires : ${tmpFiles()}`);
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
