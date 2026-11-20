import { randomUUID } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import prisma, { prismaRaw } from "../../config/prisma.js";
import {
  DEFAULT_PROVIDER,
  FILE_KINDS,
  FOLDERS,
  isValidFolder,
  storageRoot,
} from "../../config/storage.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import logger from "../../utils/logger.js";
import { sha256File } from "../../utils/checksum.js";
import * as auditService from "../audit.service.js";
import { detectKind } from "./file-type.js";
import { processImage } from "./image.processor.js";
import CloudinaryProvider from "./providers/cloudinary.provider.js";

// ---------------------------------------------------------------------------
// StorageService : seul point d'entrée pour envoyer, lire (URL) et supprimer des fichiers.
// Les contrôleurs et les services métier ne connaissent aucun fournisseur.
// Ajouter R2 : écrire R2Provider et l'enregistrer ci-dessous.
// ---------------------------------------------------------------------------
const providers = { CLOUDINARY: new CloudinaryProvider() };

export function getProvider(name = DEFAULT_PROVIDER) {
  const provider = providers[name];
  if (!provider) throw new AppError(`Fournisseur de stockage inconnu : ${name}`, 500);
  return provider;
}

// Suppression d'un fichier temporaire avec quelques essais (Windows : EBUSY transitoire).
async function safeUnlink(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(path);
      return;
    } catch (err) {
      if (err.code === "ENOENT") return;
      if (attempt === 4) logger.warn(`Fichier temporaire non supprimé : ${path}`, err.code);
      else await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

// Nom d'origine assaini : pas de chemin, pas de caractères de contrôle, longueur limitée.
// Corrige le cas courant où un nom UTF-8 arrive décodé en latin1 (« BaptÃªme »).
export function sanitizeFilename(name) {
  let value = String(name ?? "");
  if (![...value].some((c) => c.charCodeAt(0) > 0xff)) {
    const redecoded = Buffer.from(value, "latin1").toString("utf8");
    if (!redecoded.includes("�")) value = redecoded;
  }
  value = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(-200);
  return value && value !== "." && value !== ".." ? value : "fichier";
}

// {racine}/{dossier}/{AAAA}/{MM}/{JJ}/{uuid}  (+ extension pour RAW : exigée par Cloudinary)
// La date et l'uuid rendent tout conflit de nom impossible ; le nom d'origine n'y figure jamais.
export function buildPublicId({ folder, id, resourceType, ext, date = new Date() }) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const base = `${storageRoot}/${folder}/${yyyy}/${mm}/${dd}/${id}`;
  return resourceType === "RAW" ? `${base}.${ext}` : base;
}

// Représentation renvoyée à l'API : jamais d'URL http, jamais de détails internes.
export function toDto(file, extra = {}) {
  const provider = getProvider(file.provider);
  const hasThumbnail =
    file.resourceType === "IMAGE" ||
    (file.resourceType === "VIDEO" && !file.mimeType.startsWith("audio/"));
  return {
    id: file.id,
    folder: file.folder,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    resourceType: file.resourceType,
    bytes: file.bytes,
    width: file.width,
    height: file.height,
    duration: file.duration,
    url: provider.urlFor(file),
    thumbnailUrl: hasThumbnail ? provider.urlFor(file, { thumbnail: true }) : null,
    createdAt: file.createdAt,
    ...extra,
  };
}

export const urlFor = (file, options) => getProvider(file.provider).urlFor(file, options);

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------
export async function upload({ file, folder, req }) {
  const tempPaths = [file.path];
  try {
    // 1. Dossier autorisé
    if (!isValidFolder(folder)) {
      throw new AppError("Dossier inconnu", HTTP_STATUS.UNPROCESSABLE, [
        { field: "folder", message: `Dossiers autorisés : ${Object.keys(FOLDERS).join(", ")}` },
      ]);
    }

    // 2. Type réel (par le contenu), autorisé dans ce dossier
    const detected = await detectKind(file.path);
    if (!detected) {
      throw new AppError("Format de fichier non autorisé", 415);
    }
    if (!FOLDERS[folder].includes(detected.kind)) {
      throw new AppError(
        `Ce dossier n'accepte pas ce type de fichier (${detected.kind}). Types acceptés : ${FOLDERS[folder].join(", ")}`,
        HTTP_STATUS.UNPROCESSABLE,
        [{ field: "folder", message: "Type de fichier non autorisé dans ce dossier" }]
      );
    }

    // 3. Taille selon le type
    const kindDef = FILE_KINDS[detected.kind];
    if (file.size > kindDef.maxBytes) {
      throw new AppError(
        `Fichier trop volumineux (maximum ${Math.round(kindDef.maxBytes / 1024 / 1024)} Mo pour ce type)`,
        413
      );
    }

    // 4. Traitement des images : orientation puis suppression des métadonnées
    let width;
    let height;
    if (detected.kind === "image") {
      try {
        ({ width, height } = await processImage(file.path, detected.mime));
      } catch (err) {
        logger.warn("Image illisible", err.message);
        throw new AppError("Image invalide ou corrompue", 415);
      }
    }

    // 5. Empreinte et dédoublonnage
    const provider = getProvider();
    const checksum = await sha256File(file.path);
    const bytes = (await stat(file.path)).size;
    const existing = await prisma.storageFile.findFirst({
      where: { provider: provider.name, resourceType: kindDef.resourceType, checksum },
    });
    if (existing) {
      await auditUpload(req, existing, { reused: true });
      return { file: existing, reused: true };
    }

    // 6. Envoi au fournisseur
    const id = randomUUID();
    const publicId = buildPublicId({
      folder,
      id,
      resourceType: kindDef.resourceType,
      ext: detected.ext,
    });
    const sent = await provider.put({
      path: file.path,
      publicId,
      resourceType: kindDef.resourceType,
      bytes,
    });

    // 7. Enregistrement en base ; en cas d'échec, l'objet envoyé est supprimé
    let record;
    try {
      record = await prisma.storageFile.create({
        data: {
          id,
          provider: provider.name,
          publicId: sent.publicId,
          resourceType: kindDef.resourceType,
          url: sent.url,
          secureUrl: sent.secureUrl,
          folder,
          originalFilename: sanitizeFilename(file.originalname),
          mimeType: detected.mime,
          bytes,
          width: sent.width ?? width ?? null,
          height: sent.height ?? height ?? null,
          duration: sent.duration ?? null,
          checksum,
          createdById: req?.user?.id ?? null,
        },
      });
    } catch (err) {
      await provider
        .destroy({ publicId: sent.publicId, resourceType: kindDef.resourceType })
        .catch((e) => logger.error("Objet orphelin après échec base", { publicId: sent.publicId, e: e.message }));

      // Deux envois identiques simultanés : l'autre a gagné, on réutilise son fichier.
      if (err.code === "P2002") {
        const winner = await prisma.storageFile.findFirst({
          where: { provider: provider.name, resourceType: kindDef.resourceType, checksum },
        });
        if (winner) {
          await auditUpload(req, winner, { reused: true });
          return { file: winner, reused: true };
        }
      }
      throw err;
    }

    await auditUpload(req, record, { reused: false });
    return { file: record, reused: false };
  } finally {
    await Promise.all(tempPaths.map(safeUnlink));
  }
}

const auditUpload = (req, file, { reused }) =>
  auditService.record({
    action: "UPLOAD_FILE",
    entity: "storage_files",
    entityId: file.id,
    changes: {
      folder: file.folder,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      bytes: file.bytes,
      resourceType: file.resourceType,
      reused,
    },
    req,
  });

// ---------------------------------------------------------------------------
// Références : un fichier utilisé par un contenu (même supprimé logiquement, donc
// restaurable) ne doit pas être supprimé. prismaRaw voit aussi les lignes supprimées.
// ---------------------------------------------------------------------------
export async function countReferences(fileId) {
  const [events, news, dailyMessages, churchSettings, media] = await Promise.all([
    prismaRaw.event.count({ where: { coverImageId: fileId } }),
    prismaRaw.news.count({ where: { coverImageId: fileId } }),
    prismaRaw.dailyMessage.count({ where: { imageId: fileId } }),
    prismaRaw.churchSetting.count({ where: { logoId: fileId } }),
    prismaRaw.media.count({ where: { storageFileId: fileId } }),
  ]);
  const refs = { events, news, dailyMessages, churchSettings, media };
  return { total: events + news + dailyMessages + churchSettings + media, ...refs };
}

// ---------------------------------------------------------------------------
// Suppression : refusée tant que le fichier est utilisé.
// Fournisseur d'abord (une erreur laisse la ligne intacte), puis base.
// ---------------------------------------------------------------------------
export async function remove({ id, req }) {
  const file = await prisma.storageFile.findUnique({ where: { id } });
  if (!file) throw new AppError("Fichier introuvable", HTTP_STATUS.NOT_FOUND);

  const refs = await countReferences(id);
  if (refs.total > 0) {
    const { total, ...details } = refs;
    throw new AppError("Fichier utilisé par un contenu : détachez-le d'abord", HTTP_STATUS.CONFLICT, details);
  }

  await destroyFile(file);

  await auditService.record({
    action: "DELETE_FILE",
    entity: "storage_files",
    entityId: file.id,
    changes: { folder: file.folder, originalFilename: file.originalFilename, publicId: file.publicId },
    req,
  });
}

// Supprime l'objet chez le fournisseur puis la ligne en base (définitivement).
export async function destroyFile(file) {
  const provider = getProvider(file.provider);
  await provider.destroy({ publicId: file.publicId, resourceType: file.resourceType });
  await prismaRaw.storageFile.delete({ where: { id: file.id } });
}
