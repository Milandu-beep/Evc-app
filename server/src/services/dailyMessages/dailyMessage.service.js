import prisma, { prismaRaw } from "../../config/prisma.js";
import env from "../../config/env.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { domainEvents } from "../../utils/domainEvents.js";
import { dateOnlyToUtc, endOfLocalDateString } from "../../utils/timezone.js";
import { estimateReadingTime } from "../../utils/readingTime.js";
import * as auditService from "../audit.service.js";
import {
  applyTranslationOps,
  assertCoverImage,
  buildCreateRows,
  diffScalars,
  invalid,
  pageMeta,
  planTranslations,
} from "../content/common.js";
import { toAdminDto } from "./dailyMessage.dto.js";
import { TRANSITIONS, canTransition, dateString, stateWhere } from "./dailyMessage.state.js";

const INCLUDE = { translations: true, image: true };
const TEXT_FIELDS = ["title", "content", "verseReference", "verseText", "theme", "notificationTitle", "notificationBody"];
const SCALAR_FIELDS = ["date", "imageId", "sendNotification"];
const MIN_SCHEDULE_LEAD_MS = 60 * 1000; // une publication programmée doit être au moins 1 min dans le futur

// Les messages n'ont pas de slug : leur URL est leur date.
const noSlugs = null;

const dateConflict = (date) =>
  new AppError("Un message existe déjà pour cette date", HTTP_STATUS.CONFLICT, [
    { field: "date", message: `Le ${date} a déjà un message (supprimez-le ou archivez-le d'abord)` },
  ]);

// Une seule ligne active par date (index unique partiel en base) : vérifié ici pour un message clair.
async function assertDateFree(date, excludeId = null) {
  const clash = await prismaRaw.dailyMessage.findFirst({
    where: { date: dateOnlyToUtc(date), deletedAt: null, ...(excludeId && { NOT: { id: excludeId } }) },
    select: { id: true },
  });
  if (clash) throw dateConflict(date);
}

// Course entre deux créations pour la même date : l'index partiel rejette la seconde.
const mapUniqueViolation = (err, date) => (err?.code === "P2002" ? dateConflict(date) : err);

async function loadActive(id) {
  const m = await prisma.dailyMessage.findUnique({ where: { id }, include: INCLUDE });
  if (!m) throw new AppError("Message introuvable", HTTP_STATUS.NOT_FOUND);
  return m;
}

// Temps de lecture : recalculé (jamais saisi) pour chaque traduction créée ou dont le texte change.
const withReadingTime = (data, current) => ({
  ...data,
  estimatedReadingTime: estimateReadingTime(data.content ?? current?.content, data.verseText !== undefined ? data.verseText : current?.verseText),
});

// ---------------------------------------------------------------------------
// Lecture (administration)
// ---------------------------------------------------------------------------
export async function list(query, now = new Date()) {
  const { page, limit, q, state, theme, from, to, deleted, sort, order } = query;

  const and = [];
  if (state) and.push(stateWhere(state, now));
  if (from) and.push({ date: { gte: dateOnlyToUtc(from) } });
  if (to) and.push({ date: { lte: dateOnlyToUtc(to) } });
  if (theme) and.push({ translations: { some: { theme: { equals: theme, mode: "insensitive" } } } });
  if (q) {
    and.push({
      translations: {
        some: { OR: ["title", "content", "verseReference", "verseText", "theme"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) },
      },
    });
  }
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };

  const [total, rows] = await Promise.all([
    prismaRaw.dailyMessage.count({ where }),
    prismaRaw.dailyMessage.findMany({ where, include: INCLUDE, orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((m) => toAdminDto(m, now)), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const m = await prismaRaw.dailyMessage.findUnique({ where: { id }, include: INCLUDE });
  if (!m) throw new AppError("Message introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminDto(m);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations, ...fields } = input;
  await assertCoverImage(fields.imageId);
  await assertDateFree(fields.date);
  const rows = (await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools: noSlugs })).map((r) => withReadingTime(r));

  let m;
  try {
    m = await prismaRaw.dailyMessage.create({
      data: {
        date: dateOnlyToUtc(fields.date),
        imageId: fields.imageId ?? null,
        sendNotification: fields.sendNotification ?? false,
        createdById: req.user.id,
        translations: { create: rows },
      },
      include: INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err, fields.date);
  }

  await auditService.record({
    action: "CREATE",
    entity: "daily_messages",
    entityId: m.id,
    changes: { status: m.status, date: dateString(m.date), languages: rows.map((r) => r.language) },
    req,
  });
  return toAdminDto(m);
}

// ---------------------------------------------------------------------------
// Modification : champs et traductions (upsert par langue ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") {
    throw new AppError("Message archivé : désarchivez-le avant de le modifier", HTTP_STATUS.CONFLICT);
  }
  const { translations = {}, ...fields } = input;

  if ("imageId" in fields && fields.imageId !== current.imageId) await assertCoverImage(fields.imageId);
  if (fields.date && fields.date !== dateString(current.date)) await assertDateFree(fields.date, id);

  const next = { ...current, ...fields, ...(fields.date && { date: dateOnlyToUtc(fields.date) }) };
  const scalarChanges = diffScalars(current, next, SCALAR_FIELDS);
  if (scalarChanges.date) scalarChanges.date = { from: dateString(current.date), to: fields.date };

  const existingByLang = Object.fromEntries(current.translations.map((t) => [t.language, t]));
  const plan = await planTranslations({
    existingByLang,
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title", "content"],
    slugTools: noSlugs,
    parentId: id,
  });
  // Temps de lecture recalculé quand le texte ou le verset change (et à la création d'une langue)
  const ops = plan.ops.map((op) => {
    if (op.kind === "create") return { ...op, data: withReadingTime(op.data) };
    if (op.kind === "update" && ("content" in op.data || "verseText" in op.data)) {
      const existing = current.translations.find((t) => t.id === op.id);
      return { ...op, data: withReadingTime(op.data, existing) };
    }
    return op;
  });

  if (!Object.keys(scalarChanges).length && !ops.length) return toAdminDto(current);

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.dailyMessageTranslation, ops, "dailyMessageId", id);
      const data = {};
      if ("date" in fields) data.date = dateOnlyToUtc(fields.date);
      if ("imageId" in fields) data.imageId = fields.imageId ?? null;
      if ("sendNotification" in fields) data.sendNotification = fields.sendNotification;
      return tx.dailyMessage.update({ where: { id }, data, include: INCLUDE });
    });
  } catch (err) {
    throw mapUniqueViolation(err, fields.date);
  }

  await auditService.record({
    action: "UPDATE",
    entity: "daily_messages",
    entityId: id,
    changes: { fields: scalarChanges, translations: plan.changes },
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

  const m = await loadActive(id);
  if (!canTransition(action, m.status)) {
    throw new AppError(
      `Action « ${action} » impossible depuis le statut ${m.status} (statuts autorisés : ${rule.from.join(", ")})`,
      HTTP_STATUS.CONFLICT
    );
  }

  const now = new Date();
  const data = { status: rule.to };

  if (action === "publish" || action === "schedule") {
    const fr = m.translations.find((t) => t.language === DEFAULT_LANGUAGE);
    if (!fr?.title || !fr?.content) throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre et contenu français requis pour publier");
  }
  if (action === "publish") {
    Object.assign(data, { publishAt: null, publishedAt: m.publishedAt ?? now });
  } else if (action === "schedule") {
    const publishAt = body.publishAt;
    if (!publishAt || publishAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
      throw invalid("publishAt", "La publication programmée doit être au moins 1 minute dans le futur");
    }
    // Programmer après la fin du jour du message n'aurait aucun sens : il serait déjà dépassé.
    if (publishAt > endOfLocalDateString(dateString(m.date), env.timeZone)) {
      throw invalid("publishAt", "La publication doit avoir lieu au plus tard le jour du message");
    }
    data.publishAt = publishAt;
  } else {
    data.publishAt = null; // unpublish, archive, unarchive
  }

  // Mise à jour conditionnelle : si un autre administrateur a changé le statut entre-temps, 409.
  const { count } = await prismaRaw.dailyMessage.updateMany({ where: { id, status: m.status, deletedAt: null }, data });
  if (!count) throw new AppError("Le message a été modifié entre-temps, rechargez-le", HTTP_STATUS.CONFLICT);

  await auditService.record({
    action: "STATUS_CHANGE",
    entity: "daily_messages",
    entityId: id,
    changes: { action, from: m.status, to: rule.to, ...(data.publishAt && { publishAt: data.publishAt }) },
    req,
  });
  if (action === "publish") {
    // Le module de notifications attendra la date du message avant d'envoyer (date dans la charge utile).
    domainEvents.emit("daily-message.published", {
      dailyMessageId: id,
      sendNotification: m.sendNotification,
      date: dateString(m.date),
      reason: "manual",
      adminId: req?.user?.id,
    });
  }
  return toAdminDto(await prismaRaw.dailyMessage.findUnique({ where: { id }, include: INCLUDE }), now);
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration (mêmes règles que les actualités)
// ---------------------------------------------------------------------------
const DELETABLE = ["DRAFT", "SCHEDULED", "ARCHIVED"];

export async function remove(id, req) {
  const m = await loadActive(id);
  if (!DELETABLE.includes(m.status)) {
    throw new AppError(`Suppression impossible depuis le statut ${m.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  }
  await prisma.dailyMessage.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: "daily_messages", entityId: id, changes: { status: m.status, date: dateString(m.date) }, req });
}

export async function restore(id, req) {
  const m = await prismaRaw.dailyMessage.findFirst({ where: { id, deletedAt: { not: null } }, include: INCLUDE });
  if (!m) throw new AppError("Message introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  await assertDateFree(dateString(m.date), id); // la date a pu être reprise par un autre message entre-temps

  const data = { deletedAt: null, ...(m.status === "SCHEDULED" && { status: "DRAFT", publishAt: null }) };
  let restored;
  try {
    restored = await prismaRaw.dailyMessage.update({ where: { id }, data, include: INCLUDE });
  } catch (err) {
    throw mapUniqueViolation(err, dateString(m.date));
  }
  await auditService.record({ action: "RESTORE", entity: "daily_messages", entityId: id, changes: { status: restored.status }, req });
  return toAdminDto(restored);
}
