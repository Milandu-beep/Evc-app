import "./helpers/safety.mjs";
// Test d'intégration RÉEL : envoie de vrais fichiers vers Cloudinary (racine EVC-dev), ouvre les URL
// renvoyées, vérifie la suppression, puis nettoie tout ce qu'il a créé.
// Utilise la vraie base et le compte SEED_ADMIN_*. Consomme quelques crédits gratuits.
// Lancer : npm run test:storage:cloudinary
import "dotenv/config";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";

const { default: app } = await import("../src/app.js");
const { prismaRaw } = await import("../src/config/prisma.js");
const { default: env } = await import("../src/config/env.js");

if (env.isProduction) throw new Error("Ne jamais lancer ce test en production");
cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });

const started = new Date();
const server = app.listen(3117);
const base = "http://localhost:3117/api";
const res = [];
const created = []; // fichiers envoyés pendant le test (pour le nettoyage final)
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 220)); } };
const must = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
const token = (await login.json()).data.token;
async function up(buf, name, folder) {
  const fd = new FormData();
  fd.append("folder", folder);
  fd.append("file", new Blob([buf]), name);
  const r = await fetch(base + "/storage/upload", { method: "POST", headers: { authorization: "Bearer " + token }, body: fd });
  const body = await r.json();
  if (body.data?.id) created.push(body.data.id);
  return [r.status, body];
}
const del = async (id) => { const r = await fetch(base + "/storage/" + id, { method: "DELETE", headers: { authorization: "Bearer " + token } }); return [r.status, await r.json()]; };
const head = async (url, accept) => { const r = await fetch(url, { headers: accept ? { accept } : {} }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get("content-type"), size: buf.length, buf }; };

// --- Vrais fichiers de test ---
const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 60, b: 60 } } })
  .composite([{ input: Buffer.from('<svg width="640" height="480"><rect x="40" y="40" width="300" height="200" fill="#fff"/></svg>') }])
  .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret" } } }).toBuffer();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
// MP3 : 100 trames MPEG-1 Layer III valides (silence, 128 kbps, 44,1 kHz) ~ 2,6 s
const frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
const mp3 = Buffer.concat(Array.from({ length: 100 }, () => frame));

let img, pdfFile, audio;
await t("image : 201, READY, dimensions pivotées, URL HTTPS ouvrable", async () => {
  const [s, b] = await up(jpeg, "Affiche Noël.jpg", "events/covers");
  must(s === 201, s + JSON.stringify(b)); img = b.data;
  must(img.status === "READY" && img.width === 480 && img.height === 640, `${img.status} ${img.width}x${img.height}`);
  must(img.url.startsWith("https://res.cloudinary.com/"), img.url);
  const r = await head(img.url);
  must(r.status === 200 && r.type.startsWith("image/"), `${r.status} ${r.type}`);
  res.push(`    (livré en ${r.type}, ${r.size} octets)`);
});
await t("image : WebP/AVIF automatique quand le navigateur l'accepte", async () => {
  const r = await head(img.url, "image/avif,image/webp,image/*");
  must(r.status === 200 && /webp|avif/.test(r.type), `${r.status} ${r.type}`);
});
await t("image : largeur demandée (w_200) et vignette (400 px)", async () => {
  const { default: sharpLib } = await import("sharp");
  const row = await prismaRaw.storageFile.findUnique({ where: { id: img.id } });
  const { urlFor } = await import("../src/services/storage/storage.service.js");
  const small = await head(urlFor(row, { width: 200 }), "image/png");
  const sm = await sharpLib(small.buf).metadata();
  must(small.status === 200 && sm.width <= 200, `${small.status} largeur ${sm.width}`);
  const th = await head(img.thumbnailUrl, "image/png");
  const tm = await sharpLib(th.buf).metadata();
  must(th.status === 200 && tm.width <= 400, `${th.status} largeur ${tm.width}`);
});
await t("enregistrement : publicId daté + uuid, resourceType, nom d'origine accentué, URLs du fournisseur", async () => {
  const row = await prismaRaw.storageFile.findUnique({ where: { id: img.id } });
  must(/^EVC-dev\/events\/covers\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}$/.test(row.publicId), row.publicId);
  must(row.resourceType === "IMAGE" && row.originalFilename === "Affiche Noël.jpg", `${row.resourceType} ${row.originalFilename}`);
  must(row.url?.startsWith("http") && row.secureUrl?.startsWith("https://"), "url/secureUrl");
  const remote = await cloudinary.api.resource(row.publicId, { resource_type: "image" });
  must(remote.bytes === row.bytes, `octets ${remote.bytes} / ${row.bytes}`);
});
await t("même image renvoyée : 200 réutilisée", async () => {
  const [s, b] = await up(jpeg, "copie.jpg", "events/covers");
  must(s === 200 && b.data.reused && b.data.id === img.id, s + JSON.stringify(b));
});
await t("PDF : 201, RAW, URL ouvrable en application/pdf (livraison PDF activée)", async () => {
  const [s, b] = await up(pdf, "Guide Baptême.pdf", "events/documents");
  must(s === 201, s + JSON.stringify(b)); pdfFile = b.data;
  must(pdfFile.resourceType === "RAW" && pdfFile.thumbnailUrl === null, "dto");
  const r = await head(pdfFile.url);
  must(r.status === 200, `HTTP ${r.status} : si 401, activer « PDF and ZIP files delivery » dans Cloudinary > Settings > Security`);
  must(/pdf/.test(r.type) && r.buf.slice(0, 5).toString() === "%PDF-", `${r.type}`);
});
await t("audio MP3 : 201, durée lue, URL ouvrable", async () => {
  const [s, b] = await up(mp3, "predication.mp3", "sermons/audio");
  must(s === 201, s + JSON.stringify(b)); audio = b.data;
  must(audio.mimeType === "audio/mpeg" && audio.resourceType === "VIDEO", JSON.stringify(audio));
  const r = await head(audio.url);
  must(r.status === 200 && /audio|mpeg|video/.test(r.type), `${r.status} ${r.type}`);
  res.push(`    (durée enregistrée : ${audio.duration ?? "non fournie"} s)`);
});
await t("fournisseur : list() retrouve les fichiers envoyés", async () => {
  const { getProvider } = await import("../src/services/storage/storage.service.js");
  const items = await getProvider().list({ prefix: `${env.storageRoot}/events/`, resourceType: "IMAGE" });
  const row = await prismaRaw.storageFile.findUnique({ where: { id: img.id } });
  must(items.some((i) => i.publicId === row.publicId), `${items.length} objets, publicId absent`);
});
await t("DELETE : supprimé chez Cloudinary ET en base, audit écrit", async () => {
  const row = await prismaRaw.storageFile.findUnique({ where: { id: pdfFile.id } });
  const [s] = await del(pdfFile.id); must(s === 200, s);
  must(!(await prismaRaw.storageFile.findUnique({ where: { id: pdfFile.id } })), "ligne présente");
  let gone = false;
  try { await cloudinary.api.resource(row.publicId, { resource_type: "raw" }); } catch (e) { gone = e.http_code === 404 || /not found/i.test(e.error?.message ?? ""); }
  must(gone, "objet toujours chez Cloudinary");
  must((await prismaRaw.auditLog.count({ where: { action: "DELETE_FILE", entityId: pdfFile.id } })) === 1, "audit");
});
await t("audit : UPLOAD_FILE enregistré pour chaque envoi", async () => {
  const n = await prismaRaw.auditLog.count({ where: { action: "UPLOAD_FILE", createdAt: { gte: started } } });
  must(n >= 4, "n=" + n);
});

// --- Nettoyage : tout ce que ce test a créé, chez Cloudinary et en base ---
for (const id of created) {
  const row = await prismaRaw.storageFile.findUnique({ where: { id } });
  if (row) {
    await cloudinary.uploader.destroy(row.publicId, { resource_type: { IMAGE: "image", VIDEO: "video", RAW: "raw" }[row.resourceType], invalidate: true }).catch(() => {});
    await prismaRaw.storageFile.delete({ where: { id } }).catch(() => {});
  }
}
await prismaRaw.auditLog.deleteMany({ where: { createdAt: { gte: started }, action: { in: ["UPLOAD_FILE", "DELETE_FILE"] } } });
await new Promise((r) => server.close(r));
await prismaRaw.$disconnect();
console.log(res.join("\n"));
console.log("\nNon testé : vidéo MP4/WebM (aucun fichier vidéo valide disponible dans cet environnement).");
