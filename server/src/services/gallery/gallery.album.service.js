import prisma, { prismaRaw } from "../../config/prisma.js";
import env from "../../config/env.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { dateOnlyToUtc, localDateString } from "../../utils/timezone.js";
import * as auditService from "../audit.service.js";
import {
  applyTranslationOps,
  assertCoverImage,
  buildCreateRows,
  diffScalars,
  invalid,
  makeSlugTools,
  mapUniqueViolation,
  pageMeta,
  planTranslations,
} from "../content/common.js";
import { dateString } from "../dailyMessages/dailyMessage.state.js";
import { ALBUM_TRANSITIONS, canTransition } from "./gallery.common.js";
import { ALBUM_INCLUDE, toAdminAlbumDto } from "./gallery.dto.js";

const TEXT_FIELDS = ["title", "description"];
const SCALAR_FIELDS = ["date", "isFeatured", "sortOrder", "coverImageId", "linkedEventId"];
const slugTools = makeSlugTools("galleryAlbumTranslation", "albumId");
const ENTITY = "gallery_albums";

// Événement lié : doit exister (non supprimé). Son statut importe peu : le lien n'est affiché
// au public que lorsque l'événement lui-même est visible.
async function assertLinkedEvent(id) {
  if (!id) return;
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) throw invalid("linkedEventId", "Événement introuvable");
}

async function loadActive(id) {
  const album = await prisma.galleryAlbum.findUnique({ where: { id }, include: ALBUM_INCLUDE });
  if (!album) throw new AppError("Album introuvable", HTTP_STATUS.NOT_FOUND);
  return album;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
export async function list(query) {
  const { page, limit, q, status, featured, eventId, from, to, deleted, sort, order } = query;

  const and = [];
  if (status) and.push({ status });
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (eventId) and.push({ linkedEventId: eventId });
  if (from) and.push({ date: { gte: dateOnlyToUtc(from) } });
  if (to) and.push({ date: { lte: dateOnlyToUtc(to) } });
  if (q) {
    and.push({
      translations: { some: { OR: ["title", "description", "slug"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } },
    });
  }
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };

  const [total, rows] = await Promise.all([
    prismaRaw.galleryAlbum.count({ where }),
    prismaRaw.galleryAlbum.findMany({ where, include: ALBUM_INCLUDE, orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toAdminAlbumDto), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const album = await prismaRaw.galleryAlbum.findUnique({ where: { id }, include: ALBUM_INCLUDE });
  if (!album) throw new AppError("Album introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminAlbumDto(album);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations, ...fields } = input;
  await assertCoverImage(fields.coverImageId);
  await assertLinkedEvent(fields.linkedEventId);
  const rows = await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools });

  // Sans ordre précisé, le nouvel album se place à la fin de l'ordre manuel.
  const sortOrder = fields.sortOrder ?? ((await prismaRaw.galleryAlbum.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  const date = fields.date ?? localDateString(new Date(), env.timeZone);

  let album;
  try {
    album = await prismaRaw.galleryAlbum.create({
      data: {
        date: dateOnlyToUtc(date),
        isFeatured: fields.isFeatured ?? false,
        sortOrder,
        coverImageId: fields.coverImageId ?? null,
        linkedEventId: fields.linkedEventId ?? null,
        createdById: req.user.id,
        translations: { create: rows },
      },
      include: ALBUM_INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }

  await auditService.record({
    action: "CREATE",
    entity: ENTITY,
    entityId: album.id,
    changes: { status: album.status, date, languages: rows.map((r) => r.language), linkedEventId: album.linkedEventId },
    req,
  });
  return toAdminAlbumDto(album);
}

// ---------------------------------------------------------------------------
// Modification : champs et traductions (upsert par langue ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") throw new AppError("Album archivé : désarchivez-le avant de le modifier", HTTP_STATUS.CONFLICT);
  const { translations = {}, ...fields } = input;

  if ("coverImageId" in fields && fields.coverImageId !== current.coverImageId) await assertCoverImage(fields.coverImageId);
  if ("linkedEventId" in fields && fields.linkedEventId !== current.linkedEventId) await assertLinkedEvent(fields.linkedEventId);

  const next = { ...current, ...fields, ...(fields.date && { date: dateOnlyToUtc(fields.date) }) };
  const scalarChanges = diffScalars(current, next, SCALAR_FIELDS);
  if (scalarChanges.date) scalarChanges.date = { from: dateString(current.date), to: fields.date };

  const plan = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title"],
    slugTools,
    parentId: id,
  });
  if (!Object.keys(scalarChanges).length && !plan.ops.length) return toAdminAlbumDto(current);

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.galleryAlbumTranslation, plan.ops, "albumId", id);
      const data = {};
      for (const key of SCALAR_FIELDS) if (key in fields) data[key] = key === "date" ? dateOnlyToUtc(fields.date) : (fields[key] ?? null);
      return tx.galleryAlbum.update({ where: { id }, data, include: ALBUM_INCLUDE });
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }

  await auditService.record({ action: "UPDATE", entity: ENTITY, entityId: id, changes: { fields: scalarChanges, translations: plan.changes }, req });
  return toAdminAlbumDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions : publish, unpublish, archive, unarchive
// ---------------------------------------------------------------------------
export async function transition(id, action, req) {
  const rule = ALBUM_TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);

  const album = await loadActive(id);
  if (!canTransition(action, album.status)) {
    throw new AppError(`Action « ${action} » impossible depuis le statut ${album.status} (statuts autorisés : ${rule.from.join(", ")})`, HTTP_STATUS.CONFLICT);
  }

  const data = { status: rule.to };
  if (action === "publish") {
    const fr = album.translations.find((t) => t.language === DEFAULT_LANGUAGE);
    if (!fr?.title) throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre français requis pour publier");
    if (!album._count.items) throw invalid("items", "Un album vide ne peut pas être publié : ajoutez au moins un média");
    data.publishedAt = album.publishedAt ?? new Date();
  }

  // Mise à jour conditionnelle : si un autre administrateur a changé le statut entre-temps, 409.
  const { count } = await prismaRaw.galleryAlbum.updateMany({ where: { id, status: album.status, deletedAt: null }, data });
  if (!count) throw new AppError("L'album a été modifié entre-temps, rechargez-le", HTTP_STATUS.CONFLICT);

  await auditService.record({ action: "STATUS_CHANGE", entity: ENTITY, entityId: id, changes: { action, from: album.status, to: rule.to }, req });
  return toAdminAlbumDto(await prismaRaw.galleryAlbum.findUnique({ where: { id }, include: ALBUM_INCLUDE }));
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration. Les médias ne sont pas touchés : ils restent dans l'album
// (invisibles tant qu'il est supprimé) et réapparaissent avec lui.
// ---------------------------------------------------------------------------
const DELETABLE = ["DRAFT", "ARCHIVED"];

export async function remove(id, req) {
  const album = await loadActive(id);
  if (!DELETABLE.includes(album.status)) {
    throw new AppError(`Suppression impossible depuis le statut ${album.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  }
  await prisma.galleryAlbum.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { status: album.status, items: album._count.items }, req });
}

export async function restore(id, req) {
  const album = await prismaRaw.galleryAlbum.findFirst({ where: { id, deletedAt: { not: null } }, include: ALBUM_INCLUDE });
  if (!album) throw new AppError("Album introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const restored = await prismaRaw.galleryAlbum.update({ where: { id }, data: { deletedAt: null }, include: ALBUM_INCLUDE });
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { status: restored.status }, req });
  return toAdminAlbumDto(restored);
}

// ---------------------------------------------------------------------------
// Ordre d'affichage des albums : la liste doit contenir exactement les albums non supprimés
// (409 si elle est périmée : un album a été ajouté ou retiré entre-temps).
// ---------------------------------------------------------------------------
export async function reorder(ids, req) {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw invalid("ids", "Identifiants en double");
  const all = await prismaRaw.galleryAlbum.findMany({ where: { deletedAt: null }, select: { id: true } });
  const known = new Set(all.map((a) => a.id));
  if (known.size !== unique.size || ![...unique].every((id) => known.has(id))) {
    throw new AppError("Liste d'albums périmée : rechargez-la puis réessayez", HTTP_STATUS.CONFLICT);
  }
  await prismaRaw.$transaction(ids.map((id, index) => prismaRaw.galleryAlbum.update({ where: { id }, data: { sortOrder: index } })));
  await auditService.record({ action: "UPDATE", entity: ENTITY, changes: { reordered: ids.length }, req });
}
