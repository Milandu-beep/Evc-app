import "dotenv/config";
import sharp from "sharp";
import { readdirSync } from "node:fs";
// Test d orchestration du stockage avec un FAUX fournisseur (aucun appel a Cloudinary) : validation, dedoublonnage,
// base, audit, suppression, nettoyage. Utilise la vraie base et le compte SEED_ADMIN_* ; nettoie ses donnees.
// Lancer : npm run test:storage
import { randomBytes } from "node:crypto";

// Test d'orchestration avec un FAUX fournisseur (aucun appel réseau vers Cloudinary).
const { default: app } = await import("../src/app.js");
const { default: prisma, prismaRaw } = await import("../src/config/prisma.js");
const { default: CloudinaryProvider } = await import("../src/services/storage/providers/cloudinary.provider.js");
const { cleanupOrphans } = await import("../src/services/storage/cleanup.service.js");

const started = new Date();
const calls = { put: [], destroy: [] };
let forcePublicId = null;
let failNextPut = false;
let putDelayMs = 0;
CloudinaryProvider.prototype.put = async function ({ path, publicId, resourceType, bytes }) {
  if (putDelayMs) await new Promise((r) => setTimeout(r, putDelayMs));
  if (failNextPut) { failNextPut = false; const { default: AppError } = await import("./../src/utils/AppError.js"); throw new AppError("Service de stockage indisponible", 502); }
  let exif = "n/a";
  if (resourceType === "IMAGE") { const m = await sharp(path).metadata(); exif = m.exif ? "present" : "absent"; calls.lastMeta = { exif, orientation: m.orientation, width: m.width, height: m.height }; }
  const id = forcePublicId ?? publicId;
  calls.put.push({ publicId: id, resourceType });
  return { publicId: id, url: "http://stub/" + id, secureUrl: "https://stub/" + id, bytes };
};
CloudinaryProvider.prototype.destroy = async function ({ publicId, resourceType }) { calls.destroy.push({ publicId, resourceType }); return true; };
CloudinaryProvider.prototype.urlFor = function (f, o = {}) { return `https://stub/${o.thumbnail ? "thumb/" : ""}${f.publicId}`; };

const server = app.listen(3116);
const base = "http://localhost:3116/api";
const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 160)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

async function login() {
  const r = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
  return (await r.json()).data.token;
}
const token = await login();
async function up(buf, name, folder, { auth = true, mime = "application/octet-stream" } = {}) {
  const fd = new FormData();
  if (folder !== undefined) fd.append("folder", folder);
  if (buf) fd.append("file", new Blob([buf], { type: mime }), name);
  const r = await fetch(base + "/storage/upload", { method: "POST", headers: auth ? { authorization: "Bearer " + token } : {}, body: fd });
  const out = [r.status, await r.json()];
  const left = tmpFiles(); if (left.length) { console.log("LEAK après", name, folder, r.status, left); for (const f of left) (await import("node:fs")).unlinkSync(new URL("../src/uploads/tmp/" + f, import.meta.url)); }
  return out;
}
const del = async (id) => { const r = await fetch(base + "/storage/" + id, { method: "DELETE", headers: { authorization: "Bearer " + token } }); return [r.status, await r.json()]; };
const tmpFiles = () => readdirSync(new URL("../src/uploads/tmp/", import.meta.url)).filter((f) => f !== ".gitkeep");

// --- Fichiers de test ---
const jpegRotated = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#c33" } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret" } } }).toBuffer();
const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#09f" } }).png().toBuffer();
const webp = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#0a0" } }).webp().toBuffer();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const mp3 = Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00"), Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(2000)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.from([0, 0, 0, 0]), Buffer.from("mp42isom"), Buffer.alloc(500)]);
const exe = Buffer.concat([Buffer.from("MZ"), randomBytes(300)]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const bigJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(11 * 1024 * 1024)]);

await t("sans token -> 401", async () => { const [s] = await up(png, "a.png", "events/covers", { auth: false }); must(s === 401, s); });
await t("sans fichier -> 422", async () => { const [s] = await up(null, null, "events/covers"); must(s === 422, s); });
await t("dossier inconnu -> 422, temporaire nettoyé", async () => { const [s] = await up(png, "a.png", "../etc"); must(s === 422, s); must(tmpFiles().length === 0, "tmp: " + tmpFiles()); });
await t("dossier absent -> 422", async () => { const [s] = await up(png, "a.png", undefined); must(s === 422, s); });
await t("exe renommé .jpg -> 415", async () => { const [s] = await up(exe, "photo.jpg", "events/covers", { mime: "image/jpeg" }); must(s === 415, s); });
await t("SVG -> 415", async () => { const [s] = await up(svg, "x.svg", "events/covers", { mime: "image/svg+xml" }); must(s === 415, s); });
await t("PDF dans events/covers -> 422", async () => { const [s] = await up(pdf, "a.pdf", "events/covers"); must(s === 422, s); });
await t("vidéo dans events/covers -> 422", async () => { const [s] = await up(mp4, "a.mp4", "events/covers"); must(s === 422, s); });
await t("image 11 Mo -> 413", async () => { const [s] = await up(bigJpeg, "big.jpg", "events/covers"); must(s === 413, s); });
await t("aucun fichier temporaire restant", async () => must(tmpFiles().length === 0, "tmp: " + tmpFiles()));

let img;
await t("JPEG : 201, EXIF supprimé, rotation appliquée, publicId daté + uuid", async () => {
  const [s, b] = await up(jpegRotated, "affiche.jpg", "events/covers");
  must(s === 201, s + JSON.stringify(b)); img = b.data;
  must(calls.lastMeta.exif === "absent", "EXIF " + calls.lastMeta.exif);
  must(!calls.lastMeta.orientation || calls.lastMeta.orientation === 1, "orientation " + calls.lastMeta.orientation);
  must(img.width === 200 && img.height === 300, `dimensions ${img.width}x${img.height}`);
  const row = await prismaRaw.storageFile.findUnique({ where: { id: img.id } });
  must(/^EVC-dev\/events\/covers\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}$/.test(row.publicId), row.publicId);
  must(!row.publicId.includes("affiche"), "nom d'origine dans la clé");
  must(row.originalFilename === "affiche.jpg" && row.provider === "CLOUDINARY" && row.checksum.length === 64, "champs");
  must(row.url && row.secureUrl && row.createdById, "url/createdBy");
  must(img.url.startsWith("https://") && img.thumbnailUrl, "dto urls");
  must(img.status === "READY" && row.status === "READY", "statut " + img.status + "/" + row.status);
  must(row.url && row.secureUrl, "url non enregistrée");
});
await t("même image -> 200 réutilisée, aucune ligne en double", async () => {
  const before = calls.put.length;
  const [s, b] = await up(jpegRotated, "autre-nom.jpg", "events/covers");
  must(s === 200 && b.data.reused === true && b.data.id === img.id, s + JSON.stringify(b));
  must(calls.put.length === before, "renvoi inutile au fournisseur");
  must((await prismaRaw.storageFile.count({ where: { checksum: (await prismaRaw.storageFile.findUnique({ where: { id: img.id } })).checksum } })) === 1, "doublon");
});
await t("PNG et WebP acceptés", async () => { must((await up(png, "l.png", "branding/logos"))[0] === 201, "png"); must((await up(webp, "l.webp", "news/covers"))[0] === 201, "webp"); });
let pdfFile;
await t("PDF : RAW, extension dans le publicId, nom accentué conservé", async () => {
  const [s, b] = await up(pdf, "Guide Baptême.pdf", "events/documents", { mime: "application/pdf" });
  must(s === 201, s + JSON.stringify(b)); pdfFile = b.data;
  const row = await prismaRaw.storageFile.findUnique({ where: { id: pdfFile.id } });
  must(row.resourceType === "RAW" && row.publicId.endsWith(".pdf"), row.publicId);
  must(row.originalFilename === "Guide Baptême.pdf", "nom: " + row.originalFilename);
  must(pdfFile.thumbnailUrl === null, "miniature pour un PDF");
});
await t("MP3 dans sermons/audio : VIDEO, sans miniature ; MP3 dans gallery -> 422", async () => {
  const [s, b] = await up(mp3, "predication.mp3", "sermons/audio"); must(s === 201, s + JSON.stringify(b));
  must(b.data.resourceType === "VIDEO" && b.data.mimeType === "audio/mpeg" && b.data.thumbnailUrl === null, JSON.stringify(b.data));
  must((await up(mp3, "p2.mp3", "gallery"))[0] === 422, "gallery");
});
await t("MP4 dans gallery : VIDEO avec miniature", async () => { const [s, b] = await up(mp4, "clip.mp4", "gallery"); must(s === 201, s + JSON.stringify(b)); must(b.data.thumbnailUrl, "miniature"); });
await t("audit UPLOAD_FILE enregistré", async () => { const n = await prismaRaw.auditLog.count({ where: { action: "UPLOAD_FILE", createdAt: { gte: started } } }); must(n >= 6, "n=" + n); });
await t("échec base -> objet supprimé chez le fournisseur", async () => {
  forcePublicId = (await prismaRaw.storageFile.findUnique({ where: { id: img.id } })).publicId; // provoque une violation d'unicité
  const d0 = calls.destroy.length;
  const [s] = await up(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } }).png().toBuffer(), "z.png", "events/covers");
  forcePublicId = null;
  must(s >= 500, "status " + s); must(calls.destroy.length === d0 + 1, "destroy non appelé");
  const failed = await prismaRaw.storageFile.findFirst({ where: { status: "FAILED", folder: "events/covers" }, orderBy: { createdAt: "desc" } });
  must(failed, "aucune ligne FAILED");
});
await t("échec de l'envoi -> FAILED ; le même fichier peut être renvoyé ensuite (201)", async () => {
  const buf = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#abcdef" } }).png().toBuffer();
  failNextPut = true;
  const [s1] = await up(buf, "retry.png", "events/covers"); must(s1 === 502, "502 attendu, reçu " + s1);
  must((await prismaRaw.storageFile.count({ where: { status: "FAILED", originalFilename: "retry.png" } })) === 1, "pas de ligne FAILED");
  const [s2, b2] = await up(buf, "retry.png", "events/covers"); must(s2 === 201 && b2.data.status === "READY", "renvoi " + s2 + JSON.stringify(b2));
});
await t("deux envois identiques simultanés : une seule ligne active, aucune erreur 5xx", async () => {
  const buf = await sharp({ create: { width: 21, height: 21, channels: 3, background: "#fedcba" } }).png().toBuffer();
  putDelayMs = 400;
  const [a, b] = await Promise.all([up(buf, "sim.png", "events/covers"), up(buf, "sim.png", "events/covers")]);
  putDelayMs = 0;
  const codes = [a[0], b[0]].sort();
  must(codes.every((c) => [200, 201, 409].includes(c)) && codes.includes(201), "codes " + codes);
  must((await prismaRaw.storageFile.count({ where: { originalFilename: "sim.png", status: { in: ["UPLOADING", "READY"] } } })) === 1, "lignes actives != 1");
});

let ev;
await t("DELETE refusé (409) si utilisé, même par un contenu supprimé logiquement", async () => {
  ev = await prismaRaw.event.create({ data: { startsAt: new Date(), coverImageId: img.id } });
  must((await del(img.id))[0] === 409, "utilisé");
  await prisma.event.delete({ where: { id: ev.id } });
  must((await del(img.id))[0] === 409, "supprimé logiquement");
});
await t("DELETE d'un envoi en cours (UPLOADING) -> 409", async () => {
  const row = await prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "UPLOADING", publicId: "EVC-dev/test-storage/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", folder: "temporary", originalFilename: "u.png", mimeType: "image/png", bytes: 1, checksum: randomBytes(32).toString("hex") } });
  must((await del(row.id))[0] === 409, "409 attendu");
  await prismaRaw.storageFile.delete({ where: { id: row.id } });
});
await t("DELETE : 404 inconnu, 422 id invalide", async () => { must((await del("00000000-0000-4000-8000-000000000000"))[0] === 404, "404"); must((await del("abc"))[0] === 422, "422"); });
await t("DELETE : fichier libre -> 200, supprimé chez le fournisseur et en base, audit", async () => {
  await prismaRaw.event.delete({ where: { id: ev.id } });
  const row = await prismaRaw.storageFile.findUnique({ where: { id: img.id } });
  const d0 = calls.destroy.length;
  const [s] = await del(img.id); must(s === 200, s);
  must(calls.destroy.length === d0 + 1 && calls.destroy.at(-1).publicId === row.publicId, "destroy");
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: img.id } })), "ligne présente");
  must((await prismaRaw.auditLog.count({ where: { action: "DELETE_FILE", entityId: img.id } })) === 1, "audit");
});

await t("nettoyage : dry-run ne change rien ; marquage après 24 h ; purge après 30 j ; fichier utilisé jamais touché", async () => {
  const day = 86400000;
  const mk = (extra) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", status: "READY", publicId: "EVC-dev/test-storage/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", url: "http://x", secureUrl: "https://x", folder: "temporary", originalFilename: "t.png", mimeType: "image/png", bytes: 1, checksum: randomBytes(32).toString("hex"), ...extra } });
  const old = await mk({ createdAt: new Date(Date.now() - 2 * day) });
  const recent = await mk({});
  const used = await mk({ createdAt: new Date(Date.now() - 90 * day) });
  const usedEv = await prismaRaw.event.create({ data: { startsAt: new Date(), coverImageId: used.id } });
  const dry = await cleanupOrphans({ dryRun: true });
  must(dry.marked >= 1 && (await prismaRaw.storageFile.findUnique({ where: { id: old.id } })).deletedAt === null, "dry-run a modifié");
  await cleanupOrphans();
  const marked = await prismaRaw.storageFile.findUnique({ where: { id: old.id } });
  must(marked.deletedAt && marked.status === "DELETED", "old non marqué DELETED");
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: recent.id } })).deletedAt, "recent marqué");
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: used.id } })).deletedAt, "used marqué");
  await prismaRaw.storageFile.update({ where: { id: old.id }, data: { deletedAt: new Date(Date.now() - 31 * day) } });
  const d0 = calls.destroy.length;
  await cleanupOrphans();
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: old.id } })), "old non purgé");
  must(calls.destroy.length === d0 + 1, "destroy");
  must(await prismaRaw.storageFile.findUnique({ where: { id: used.id } }), "used purgé !");
  await prismaRaw.event.delete({ where: { id: usedEv.id } }); await prismaRaw.storageFile.deleteMany({ where: { id: { in: [recent.id, used.id] } } });
});
await t("nettoyage : envoi UPLOADING interrompu -> FAILED ; FAILED ancien supprimé ; envoi récent intact", async () => {
  const mk = (extra) => prismaRaw.storageFile.create({ data: { provider: "CLOUDINARY", publicId: "EVC-dev/test-storage/" + randomBytes(6).toString("hex"), resourceType: "IMAGE", folder: "temporary", originalFilename: "s.png", mimeType: "image/png", bytes: 1, checksum: randomBytes(32).toString("hex"), ...extra } });
  const stuck = await mk({ status: "UPLOADING", createdAt: new Date(Date.now() - 2 * 3600000) });
  const fresh = await mk({ status: "UPLOADING" });
  const oldFailed = await mk({ status: "FAILED", createdAt: new Date(Date.now() - 8 * 86400000) });
  const d0 = calls.destroy.length;
  await cleanupOrphans();
  must((await prismaRaw.storageFile.findUnique({ where: { id: stuck.id } })).status === "FAILED", "stuck non FAILED");
  must(calls.destroy.length >= d0 + 1, "objet éventuel non supprimé");
  must((await prismaRaw.storageFile.findUnique({ where: { id: fresh.id } })).status === "UPLOADING", "envoi récent modifié");
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: oldFailed.id } })), "FAILED ancien présent");
});
await t("aucun fichier temporaire restant (fin)", async () => must(tmpFiles().length === 0, "tmp: " + tmpFiles()));

// --- Nettoyage des données de test ---
await prismaRaw.storageFile.deleteMany({ where: { OR: [{ createdAt: { gte: started } }, { publicId: { startsWith: "EVC-dev/test-storage/" } }] } });
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, action: { in: ["UPLOAD_FILE", "DELETE_FILE"] } } });
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
