import prisma, { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import * as auditService from "../audit.service.js";
import { applyTranslationOps, invalid, pageMeta, planTranslations } from "../content/common.js";
import * as storageService from "../storage/storage.service.js";
import { ITEM_ORDER, itemTypeOf, normalizeTags } from "./gallery.common.js";
import { ITEM_INCLUDE, toAdminItemDto } from "./gallery.dto.js";

const ENTITY = "gallery_items";
const TEXT_FIELDS = ["title", "description", "altText"];

// L'album doit exister et ne pas être archivé (on ne modifie pas un album archivé).
async function loadWritableAlbum(albumId) {
  const album = await prisma.galleryAlbum.findUnique({ where: { id: albumId }, select: { id: true, status: true } });
  if (!album) throw new AppError("Album introuvable", HTTP_STATUS.NOT_FOUND);
  if (album.status === "ARCHIVED") throw new AppError("Album archivé : désarchivez-le avant de le modifier", HTTP_STATUS.CONFLICT);
  return album;
}

// Prochaine position libre (à la fin) dans un album.
async function nextPosition(client, albumId) {
  const max = await client.galleryItem.aggregate({ where: { albumId, deletedAt: null }, _max: { position: true } });
  return (max._max.position ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
export async function list(albumId, { deleted = false, page = 1, limit = 50 } = {}) {
  const album = await prismaRaw.galleryAlbum.findUnique({ where: { id: albumId }, select: { id: true } });
  if (!album) throw new AppError("Album introuvable", HTTP_STATUS.NOT_FOUND);
  const where = { albumId, deletedAt: deleted ? { not: null } : null };
  const [total, rows] = await Promise.all([
    prismaRaw.galleryItem.count({ where }),
    prismaRaw.galleryItem.findMany({ where, include: ITEM_INCLUDE, orderBy: ITEM_ORDER, skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toAdminItemDto), meta: pageMeta(page, limit, total) };
}

// Tags utilisés (médias actifs d'albums non supprimés), avec leur nombre d'usages.
export async function tags() {
  const rows = await prismaRaw.$queryRaw`
    SELECT t AS tag, count(*)::int AS count
      FROM "gallery_items" i
      JOIN "gallery_albums" a ON a."id" = i."albumId", unnest(i."tags") AS t
     WHERE i."deletedAt" IS NULL AND a."deletedAt" IS NULL
     GROUP BY t ORDER BY count DESC, t ASC LIMIT 500`;
  return rows;
}

// ---------------------------------------------------------------------------
// Ajout de médias à un album. Un même fichier ne figure qu'une fois par album.
// Retourne { created, skipped } : les doublons sont signalés, jamais une erreur.
// ---------------------------------------------------------------------------
async function createItems(albumId, files, tags, req) {
  const created = [];
  const skipped = [];
  await prismaRaw.$transaction(async (tx) => {
    const existing = new Set((await tx.galleryItem.findMany({ where: { albumId, deletedAt: null }, select: { storageFileId: true } })).map((i) => i.storageFileId));
    let position = await nextPosition(tx, albumId);
    for (const file of files) {
      if (existing.has(file.id)) {
        skipped.push({ storageFileId: file.id, originalFilename: file.originalFilename, reason: "Déjà dans l'album" });
        continue;
      }
      const item = await tx.galleryItem.create({
        data: { albumId, storageFileId: file.id, type: itemTypeOf(file), position, tags, createdById: req.user.id },
        include: ITEM_INCLUDE,
      });
      existing.add(file.id);
      position += 1;
      created.push(item);
    }
  });
  if (created.length) {
    await auditService.record({
      action: "CREATE",
      entity: ENTITY,
      changes: { albumId, count: created.length, itemIds: created.map((i) => i.id), tags },
      req,
    });
  }
  return { created: created.map(toAdminItemDto), skipped };
}

// Rattache des fichiers DÉJÀ envoyés (POST /storage/upload) à un album.
export async function attach(albumId, { storageFileIds, tags }, req) {
  await loadWritableAlbum(albumId);
  const normalized = normalizeTags(tags);

  const found = await prisma.storageFile.findMany({ where: { id: { in: storageFileIds } } });
  const byId = new Map(found.map((f) => [f.id, f]));
  const failed = [];
  const files = [];
  for (const id of [...new Set(storageFileIds)]) {
    const f = byId.get(id);
    if (!f || f.status !== "READY") failed.push({ storageFileId: id, reason: "Fichier introuvable ou non prêt" });
    else if (!itemTypeOf(f)) failed.push({ storageFileId: id, reason: "Seules les photos et les vidéos peuvent figurer dans une galerie" });
    else files.push(f);
  }
  const result = await createItems(albumId, files, normalized, req);
  return { ...result, failed };
}

// Import multiple : envoie chaque fichier (StorageService : validation, EXIF, dédoublonnage, audit) puis le rattache.
// Un fichier refusé n'empêche pas les autres : le rapport indique, fichier par fichier, ce qui s'est passé.
export async function importFiles(albumId, uploads, { tags }, req) {
  await loadWritableAlbum(albumId);
  const normalized = normalizeTags(tags);

  const uploaded = [];
  const failed = [];
  for (const upload of uploads) {
    try {
      const { file } = await storageService.upload({ file: upload, folder: "gallery", req });
      if (file.status !== "READY") throw new AppError("Fichier non prêt", HTTP_STATUS.CONFLICT);
      uploaded.push(file);
    } catch (err) {
      failed.push({ originalFilename: storageService.sanitizeFilename(upload.originalname), status: err.statusCode ?? 500, reason: err.statusCode ? err.message : "Erreur interne" });
    }
  }
  const result = await createItems(albumId, uploaded, normalized, req);
  return { ...result, failed };
}

// ---------------------------------------------------------------------------
// Modification d'un média : tags (remplacés) et textes par langue (titre, description, texte alternatif).
// « translations.xx: null » supprime une langue ; aucune langue n'est obligatoire pour un média.
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const item = await prisma.galleryItem.findUnique({ where: { id }, include: ITEM_INCLUDE });
  if (!item) throw new AppError("Média introuvable", HTTP_STATUS.NOT_FOUND);
  await loadWritableAlbum(item.albumId);

  const tags = "tags" in input ? normalizeTags(input.tags) : undefined;
  const plan = await planTranslations({
    existingByLang: Object.fromEntries(item.translations.map((t) => [t.language, t])),
    translations: input.translations ?? {},
    textFields: TEXT_FIELDS,
    requiredOnCreate: [],
    slugTools: null,
    parentId: id,
    requireDefault: false,
  });
  // Ne crée pas de traduction vide (toutes les valeurs absentes ou nulles)
  const ops = plan.ops.filter((op) => op.kind !== "create" || TEXT_FIELDS.some((f) => op.data[f]));
  for (const key of Object.keys(plan.changes)) {
    if (plan.changes[key] === "created" && !ops.some((o) => o.kind === "create" && o.data.language === key)) delete plan.changes[key];
  }

  const tagsChanged = tags && JSON.stringify(tags) !== JSON.stringify(item.tags);
  if (!tagsChanged && !ops.length) return toAdminItemDto(item);

  const updated = await prismaRaw.$transaction(async (tx) => {
    await applyTranslationOps(tx.galleryItemTranslation, ops, "itemId", id);
    return tx.galleryItem.update({ where: { id }, data: tagsChanged ? { tags } : {}, include: ITEM_INCLUDE });
  });

  await auditService.record({
    action: "UPDATE",
    entity: ENTITY,
    entityId: id,
    changes: { ...(tagsChanged && { tags: { from: item.tags, to: tags } }), translations: plan.changes },
    req,
  });
  return toAdminItemDto(updated);
}

// ---------------------------------------------------------------------------
// Réorganisation : la liste doit contenir exactement les médias actifs de l'album (409 si périmée).
// ---------------------------------------------------------------------------
export async function reorder(albumId, itemIds, req) {
  await loadWritableAlbum(albumId);
  const unique = new Set(itemIds);
  if (unique.size !== itemIds.length) throw invalid("itemIds", "Identifiants en double");
  const current = await prismaRaw.galleryItem.findMany({ where: { albumId, deletedAt: null }, select: { id: true } });
  const known = new Set(current.map((i) => i.id));
  if (known.size !== unique.size || ![...unique].every((id) => known.has(id))) {
    throw new AppError("Liste de médias périmée : rechargez l'album puis réessayez", HTTP_STATUS.CONFLICT);
  }
  await prismaRaw.$transaction(itemIds.map((id, index) => prismaRaw.galleryItem.update({ where: { id }, data: { position: index } })));
  await auditService.record({ action: "UPDATE", entity: ENTITY, changes: { albumId, reordered: itemIds.length }, req });
}

// ---------------------------------------------------------------------------
// Déplacement de médias vers un autre album (ajoutés à la fin, dans l'ordre demandé).
// Tags et textes suivent. Un média déjà présent (même fichier) dans la cible est signalé et laissé en place.
// ---------------------------------------------------------------------------
export async function move(itemIds, toAlbumId, req) {
  await loadWritableAlbum(toAlbumId);
  const unique = [...new Set(itemIds)];
  const items = await prisma.galleryItem.findMany({ where: { id: { in: unique } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length) throw invalid("itemIds", `Médias introuvables : ${missing.join(", ")}`);

  const moved = [];
  const skipped = [];
  await prismaRaw.$transaction(async (tx) => {
    const inTarget = new Set((await tx.galleryItem.findMany({ where: { albumId: toAlbumId, deletedAt: null }, select: { storageFileId: true } })).map((i) => i.storageFileId));
    let position = await nextPosition(tx, toAlbumId);
    for (const id of unique) {
      const item = byId.get(id);
      if (item.albumId === toAlbumId) {
        skipped.push({ itemId: id, reason: "Déjà dans cet album" });
      } else if (inTarget.has(item.storageFileId)) {
        skipped.push({ itemId: id, reason: "Ce fichier figure déjà dans l'album cible" });
      } else {
        moved.push({ id, from: item.albumId });
        await tx.galleryItem.update({ where: { id }, data: { albumId: toAlbumId, position } });
        inTarget.add(item.storageFileId);
        position += 1;
      }
    }
  });

  if (moved.length) {
    await auditService.record({
      action: "UPDATE",
      entity: ENTITY,
      changes: { moved: moved.length, itemIds: moved.map((m) => m.id), fromAlbumIds: [...new Set(moved.map((m) => m.from))], toAlbumId },
      req,
    });
  }
  return { moved: moved.map((m) => m.id), skipped };
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration d'un média
// ---------------------------------------------------------------------------
export async function remove(id, req) {
  const item = await prisma.galleryItem.findUnique({ where: { id } });
  if (!item) throw new AppError("Média introuvable", HTTP_STATUS.NOT_FOUND);
  await prisma.galleryItem.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { albumId: item.albumId }, req });
}

export async function restore(id, req) {
  const item = await prismaRaw.galleryItem.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!item) throw new AppError("Média introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);

  const album = await prismaRaw.galleryAlbum.findUnique({ where: { id: item.albumId }, select: { deletedAt: true } });
  if (!album || album.deletedAt) throw new AppError("L'album de ce média est dans la corbeille : restaurez-le d'abord", HTTP_STATUS.CONFLICT);
  const twin = await prismaRaw.galleryItem.findFirst({ where: { albumId: item.albumId, storageFileId: item.storageFileId, deletedAt: null }, select: { id: true } });
  if (twin) throw new AppError("Ce fichier a été ajouté de nouveau à l'album entre-temps", HTTP_STATUS.CONFLICT);

  const restored = await prismaRaw.$transaction(async (tx) =>
    tx.galleryItem.update({ where: { id }, data: { deletedAt: null, position: await nextPosition(tx, item.albumId) }, include: ITEM_INCLUDE })
  );
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { albumId: item.albumId }, req });
  return toAdminItemDto(restored);
}
