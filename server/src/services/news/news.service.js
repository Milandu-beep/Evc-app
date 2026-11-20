import prisma, { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { domainEvents } from "../../utils/domainEvents.js";
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
import { toAdminDto } from "./news.dto.js";
import { TRANSITIONS, canTransition, stateWhere } from "./news.state.js";

const INCLUDE = { translations: true, coverImage: true };
const TEXT_FIELDS = ["title", "excerpt", "content"];
const SCALAR_FIELDS = ["coverImageId", "isFeatured", "notifyOnPublish"];
const MIN_SCHEDULE_LEAD_MS = 60 * 1000; // une publication programmée doit être au moins 1 min dans le futur

const slugTools = makeSlugTools("newsTranslation", "newsId");

async function loadActive(id) {
  const news = await prisma.news.findUnique({ where: { id }, include: INCLUDE });
  if (!news) throw new AppError("Actualité introuvable", HTTP_STATUS.NOT_FOUND);
  return news;
}

// ---------------------------------------------------------------------------
// Lecture (administration)
// ---------------------------------------------------------------------------
export async function list(query, now = new Date()) {
  const { page, limit, q, state, featured, from, to, deleted, sort, order } = query;

  const and = [];
  if (state) and.push(stateWhere(state, now));
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (from) and.push({ createdAt: { gte: from } });
  if (to) and.push({ createdAt: { lte: to } });
  if (q) {
    and.push({
      translations: {
        some: { OR: ["title", "excerpt", "content", "slug"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) },
      },
    });
  }
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };

  // publishedAt peut être vide (brouillons) : les lignes sans date passent en dernier.
  const orderBy = sort === "publishedAt" ? { publishedAt: { sort: order, nulls: "last" } } : { [sort]: order };
  const [total, rows] = await Promise.all([
    prismaRaw.news.count({ where }),
    prismaRaw.news.findMany({ where, include: INCLUDE, orderBy: [orderBy, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((n) => toAdminDto(n, now)), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const news = await prismaRaw.news.findUnique({ where: { id }, include: INCLUDE });
  if (!news) throw new AppError("Actualité introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminDto(news);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations, ...fields } = input;
  await assertCoverImage(fields.coverImageId);
  const rows = await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools });

  let news;
  try {
    news = await prismaRaw.news.create({
      data: {
        isFeatured: fields.isFeatured ?? false,
        coverImageId: fields.coverImageId ?? null,
        notifyOnPublish: fields.notifyOnPublish ?? false,
        createdById: req.user.id,
        translations: { create: rows },
      },
      include: INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }

  await auditService.record({
    action: "CREATE",
    entity: "news",
    entityId: news.id,
    changes: { status: news.status, languages: rows.map((r) => r.language) },
    req,
  });
  return toAdminDto(news);
}

// ---------------------------------------------------------------------------
// Modification : champs et traductions (upsert par langue ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") {
    throw new AppError("Actualité archivée : désarchivez-la avant de la modifier", HTTP_STATUS.CONFLICT);
  }
  const { translations = {}, ...fields } = input;
  const next = { ...current, ...fields };
  if ("coverImageId" in fields && fields.coverImageId !== current.coverImageId) await assertCoverImage(fields.coverImageId);

  const scalarChanges = diffScalars(current, next, SCALAR_FIELDS);
  const { ops, changes: translationChanges } = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title", "content"],
    slugTools,
    parentId: id,
  });
  if (!Object.keys(scalarChanges).length && !ops.length) return toAdminDto(current);

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.newsTranslation, ops, "newsId", id);
      return tx.news.update({
        where: { id },
        data: Object.fromEntries(SCALAR_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k] ?? null])),
        include: INCLUDE,
      });
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }

  await auditService.record({
    action: "UPDATE",
    entity: "news",
    entityId: id,
    changes: { fields: scalarChanges, translations: translationChanges },
    req,
  });
  return toAdminDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions de statut : publish, schedule, unpublish, archive, unarchive
// ---------------------------------------------------------------------------
export async function transition(id, action, body = {}, req) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);

  const news = await loadActive(id);
  if (!canTransition(action, news.status)) {
    throw new AppError(
      `Action « ${action} » impossible depuis le statut ${news.status} (statuts autorisés : ${rule.from.join(", ")})`,
      HTTP_STATUS.CONFLICT
    );
  }

  const now = new Date();
  const data = { status: rule.to };

  if (action === "publish" || action === "schedule") {
    const fr = news.translations.find((t) => t.language === DEFAULT_LANGUAGE);
    if (!fr?.title || !fr?.content) throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre et contenu français requis pour publier");
  }
  if (action === "publish") {
    Object.assign(data, { publishAt: null, publishedAt: news.publishedAt ?? now });
  } else if (action === "schedule") {
    const publishAt = body.publishAt;
    if (!publishAt || publishAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
      throw invalid("publishAt", "La publication programmée doit être au moins 1 minute dans le futur");
    }
    data.publishAt = publishAt;
  } else {
    data.publishAt = null; // unpublish, archive, unarchive
  }

  // Mise à jour conditionnelle : si un autre administrateur a changé le statut entre-temps, 409.
  const { count } = await prismaRaw.news.updateMany({ where: { id, status: news.status, deletedAt: null }, data });
  if (!count) throw new AppError("L'actualité a été modifiée entre-temps, rechargez-la", HTTP_STATUS.CONFLICT);

  await auditService.record({
    action: "STATUS_CHANGE",
    entity: "news",
    entityId: id,
    changes: { action, from: news.status, to: rule.to, ...(data.publishAt && { publishAt: data.publishAt }) },
    req,
  });
  if (action === "publish") {
    domainEvents.emit("news.published", { newsId: id, notifyOnPublish: news.notifyOnPublish, reason: "manual", adminId: req?.user?.id });
  }
  return toAdminDto(await prismaRaw.news.findUnique({ where: { id }, include: INCLUDE }), now);
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration (mêmes règles que les événements)
// ---------------------------------------------------------------------------
const DELETABLE = ["DRAFT", "SCHEDULED", "ARCHIVED"];

export async function remove(id, req) {
  const news = await loadActive(id);
  if (!DELETABLE.includes(news.status)) {
    throw new AppError(`Suppression impossible depuis le statut ${news.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  }
  await prisma.news.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: "news", entityId: id, changes: { status: news.status }, req });
}

export async function restore(id, req) {
  const news = await prismaRaw.news.findFirst({ where: { id, deletedAt: { not: null } }, include: INCLUDE });
  if (!news) throw new AppError("Actualité introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const data = { deletedAt: null, ...(news.status === "SCHEDULED" && { status: "DRAFT", publishAt: null }) };
  const restored = await prismaRaw.news.update({ where: { id }, data, include: INCLUDE });
  await auditService.record({ action: "RESTORE", entity: "news", entityId: id, changes: { status: restored.status }, req });
  return toAdminDto(restored);
}
