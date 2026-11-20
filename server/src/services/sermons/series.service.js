import prisma, { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import * as auditService from "../audit.service.js";
import { applyTranslationOps, assertCoverImage, buildCreateRows, diffScalars, invalid, makeSlugTools, mapUniqueViolation, pageMeta, planTranslations } from "../content/common.js";
import { PUBLISH_TRANSITIONS, canPublishTransition } from "../content/simpleLifecycle.js";
import { seriesAdminInclude, toAdminSeriesDto } from "./sermon.dto.js";

const ENTITY = "sermon_series";
const TEXT_FIELDS = ["title", "description"];
const SCALAR_FIELDS = ["sortOrder", "isFeatured", "coverImageId"];
const slugTools = makeSlugTools("sermonSeriesTranslation", "seriesId");
const INCLUDE = seriesAdminInclude({ deletedAt: null }); // sermonCount : prédications non supprimées

async function loadActive(id) {
  const s = await prisma.sermonSeries.findUnique({ where: { id }, include: INCLUDE });
  if (!s) throw new AppError("Série introuvable", HTTP_STATUS.NOT_FOUND);
  return s;
}

export async function list(query) {
  const { page, limit, q, status, featured, deleted, sort, order } = query;
  const and = [];
  if (status) and.push({ status });
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (q) and.push({ translations: { some: { OR: ["title", "description", "slug"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } });
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };
  const [total, rows] = await Promise.all([
    prismaRaw.sermonSeries.count({ where }),
    prismaRaw.sermonSeries.findMany({ where, include: INCLUDE, orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toAdminSeriesDto), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const s = await prismaRaw.sermonSeries.findUnique({ where: { id }, include: INCLUDE });
  if (!s) throw new AppError("Série introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminSeriesDto(s);
}

export async function create(input, req) {
  const { translations, ...fields } = input;
  await assertCoverImage(fields.coverImageId);
  const rows = await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools });
  const sortOrder = fields.sortOrder ?? ((await prismaRaw.sermonSeries.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  let series;
  try {
    series = await prismaRaw.sermonSeries.create({
      data: { sortOrder, isFeatured: fields.isFeatured ?? false, coverImageId: fields.coverImageId ?? null, createdById: req.user.id, translations: { create: rows } },
      include: INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }
  await auditService.record({ action: "CREATE", entity: ENTITY, entityId: series.id, changes: { status: series.status, languages: rows.map((r) => r.language) }, req });
  return toAdminSeriesDto(series);
}

export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") throw new AppError("Série archivée : désarchivez-la avant de la modifier", HTTP_STATUS.CONFLICT);
  const { translations = {}, ...fields } = input;
  if ("coverImageId" in fields && fields.coverImageId !== current.coverImageId) await assertCoverImage(fields.coverImageId);
  const scalarChanges = diffScalars(current, { ...current, ...fields }, SCALAR_FIELDS);
  const plan = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title"],
    slugTools,
    parentId: id,
  });
  if (!Object.keys(scalarChanges).length && !plan.ops.length) return toAdminSeriesDto(current);
  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.sermonSeriesTranslation, plan.ops, "seriesId", id);
      return tx.sermonSeries.update({ where: { id }, data: Object.fromEntries(SCALAR_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k] ?? null])), include: INCLUDE });
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }
  await auditService.record({ action: "UPDATE", entity: ENTITY, entityId: id, changes: { fields: scalarChanges, translations: plan.changes }, req });
  return toAdminSeriesDto(updated);
}

export async function transition(id, action, req) {
  const rule = PUBLISH_TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);
  const series = await loadActive(id);
  if (!canPublishTransition(action, series.status)) {
    throw new AppError(`Action « ${action} » impossible depuis le statut ${series.status} (statuts autorisés : ${rule.from.join(", ")})`, HTTP_STATUS.CONFLICT);
  }
  if (action === "publish" && !series.translations.find((t) => t.language === DEFAULT_LANGUAGE)?.title) throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre français requis pour publier");
  const data = { status: rule.to, ...(action === "publish" && { publishedAt: series.publishedAt ?? new Date() }) };
  const { count } = await prismaRaw.sermonSeries.updateMany({ where: { id, status: series.status, deletedAt: null }, data });
  if (!count) throw new AppError("La série a été modifiée entre-temps, rechargez-la", HTTP_STATUS.CONFLICT);
  await auditService.record({ action: "STATUS_CHANGE", entity: ENTITY, entityId: id, changes: { action, from: series.status, to: rule.to }, req });
  return toAdminSeriesDto(await prismaRaw.sermonSeries.findUnique({ where: { id }, include: INCLUDE }));
}

const DELETABLE = ["DRAFT", "ARCHIVED"];
export async function remove(id, req) {
  const series = await loadActive(id);
  if (!DELETABLE.includes(series.status)) throw new AppError(`Suppression impossible depuis le statut ${series.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  if (series._count.sermons > 0) throw new AppError("Cette série contient des prédications : retirez-les ou archivez la série", HTTP_STATUS.CONFLICT, { sermons: series._count.sermons });
  await prisma.sermonSeries.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { status: series.status }, req });
}

export async function restore(id, req) {
  const series = await prismaRaw.sermonSeries.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!series) throw new AppError("Série introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const restored = await prismaRaw.sermonSeries.update({ where: { id }, data: { deletedAt: null }, include: INCLUDE });
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { status: restored.status }, req });
  return toAdminSeriesDto(restored);
}
