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
import { toAdminDto } from "./event.dto.js";
import { TRANSITIONS, canTransition, computeState, endOf, stateWhere } from "./event.state.js";

const INCLUDE = { translations: true, coverImage: true };
const TEXT_FIELDS = ["title", "description", "location"];
// registeredCount n'y figure volontairement pas : il appartient au futur module d'inscription.
const SCALAR_FIELDS = [
  "type",
  "startsAt",
  "endsAt",
  "isFeatured",
  "coverImageId",
  "capacity",
  "color",
  "icon",
  "registrationRequired",
  "registrationUrl",
  "notifyOnPublish",
];
const MIN_SCHEDULE_LEAD_MS = 60 * 1000; // une publication programmée doit être au moins 1 min dans le futur

// « calendar » est une route (/api/events/calendar) : on ne peut pas l'utiliser comme identifiant d'URL.
const slugTools = makeSlugTools("eventTranslation", "eventId", { reserved: ["calendar"] });

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function assertDates(startsAt, endsAt) {
  if (endsAt && endsAt < startsAt) throw invalid("endsAt", "La fin ne peut pas précéder le début");
}

async function loadActive(id) {
  const event = await prisma.event.findUnique({ where: { id }, include: INCLUDE });
  if (!event) throw new AppError("Événement introuvable", HTTP_STATUS.NOT_FOUND);
  return event;
}

// ---------------------------------------------------------------------------
// Lecture (administration)
// ---------------------------------------------------------------------------
export async function list(query, now = new Date()) {
  const { page, limit, q, state, type, featured, from, to, registrationRequired, deleted, sort, order } = query;

  const and = [];
  if (state) and.push(stateWhere(state, now));
  if (type) and.push({ type });
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (registrationRequired !== undefined) and.push({ registrationRequired });
  if (from) and.push({ startsAt: { gte: from } });
  if (to) and.push({ startsAt: { lte: to } });
  if (q) {
    and.push({
      translations: {
        some: {
          OR: ["title", "description", "location", "slug"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })),
        },
      },
    });
  }
  // « deleted » : corbeille uniquement ; sinon événements actifs.
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };

  const [total, rows] = await Promise.all([
    prismaRaw.event.count({ where }),
    prismaRaw.event.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ [sort]: order }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { items: rows.map((e) => toAdminDto(e, now)), meta: pageMeta(page, limit, total) };
}

export async function getById(id, { includeDeleted = false } = {}) {
  const event = includeDeleted
    ? await prismaRaw.event.findUnique({ where: { id }, include: INCLUDE })
    : await loadActive(id);
  if (!event) throw new AppError("Événement introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminDto(event);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations, ...fields } = input;
  assertDates(fields.startsAt, fields.endsAt ?? null);
  await assertCoverImage(fields.coverImageId);
  const rows = await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools });

  let event;
  try {
    event = await prismaRaw.event.create({
      data: {
        type: fields.type ?? "OTHER",
        startsAt: fields.startsAt,
        endsAt: fields.endsAt ?? null,
        isFeatured: fields.isFeatured ?? false,
        coverImageId: fields.coverImageId ?? null,
        capacity: fields.capacity ?? null,
        color: fields.color ?? null,
        icon: fields.icon ?? null,
        registrationRequired: fields.registrationRequired ?? false,
        registrationUrl: fields.registrationUrl ?? null,
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
    entity: "events",
    entityId: event.id,
    changes: { status: event.status, type: event.type, languages: rows.map((r) => r.language), startsAt: event.startsAt },
    req,
  });
  return toAdminDto(event);
}

// ---------------------------------------------------------------------------
// Modification : champs et traductions (upsert par langue ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") {
    throw new AppError("Événement archivé : désarchivez-le avant de le modifier", HTTP_STATUS.CONFLICT);
  }
  const { translations = {}, ...fields } = input;

  const next = { ...current, ...fields };
  assertDates(next.startsAt, next.endsAt);
  if ("coverImageId" in fields && fields.coverImageId !== current.coverImageId) await assertCoverImage(fields.coverImageId);
  if (next.capacity != null && next.capacity < current.registeredCount) {
    throw invalid("capacity", `La capacité ne peut pas être inférieure au nombre d'inscrits (${current.registeredCount})`);
  }

  const scalarChanges = diffScalars(current, next, SCALAR_FIELDS);
  const { ops, changes: translationChanges } = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title", "description"],
    slugTools,
    parentId: id,
  });

  if (!Object.keys(scalarChanges).length && !ops.length) return toAdminDto(current); // rien à faire

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.eventTranslation, ops, "eventId", id);
      return tx.event.update({
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
    entity: "events",
    entityId: id,
    changes: { fields: scalarChanges, translations: translationChanges },
    req,
  });
  return toAdminDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions de statut : publish, schedule, unpublish, cancel, archive, unarchive
// ---------------------------------------------------------------------------
export async function transition(id, action, body = {}, req) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);

  const event = await loadActive(id);
  if (!canTransition(action, event.status)) {
    throw new AppError(
      `Action « ${action} » impossible depuis le statut ${event.status} (statuts autorisés : ${rule.from.join(", ")})`,
      HTTP_STATUS.CONFLICT
    );
  }

  const now = new Date();
  const data = { status: rule.to };

  if (action === "publish" || action === "schedule") {
    const fr = event.translations.find((t) => t.language === DEFAULT_LANGUAGE);
    if (!fr?.title || !fr?.description) {
      throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre et description français requis pour publier");
    }
  }
  if (action === "publish") {
    Object.assign(data, { publishAt: null, publishedAt: event.publishedAt ?? now, cancelledAt: null });
  } else if (action === "schedule") {
    const publishAt = body.publishAt;
    if (!publishAt || publishAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
      throw invalid("publishAt", "La publication programmée doit être au moins 1 minute dans le futur");
    }
    if (publishAt >= endOf(event)) {
      throw invalid("publishAt", "La publication doit précéder la fin de l'événement");
    }
    data.publishAt = publishAt;
  } else if (action === "unpublish" || action === "unarchive") {
    Object.assign(data, { publishAt: null, cancelledAt: null });
  } else if (action === "cancel") {
    data.cancelledAt = now;
  } else if (action === "archive") {
    data.publishAt = null;
  }

  // Mise à jour conditionnelle : si un autre administrateur a changé le statut entre-temps, 409.
  const { count } = await prismaRaw.event.updateMany({
    where: { id, status: event.status, deletedAt: null },
    data,
  });
  if (!count) throw new AppError("L'événement a été modifié entre-temps, rechargez-le", HTTP_STATUS.CONFLICT);

  await auditService.record({
    action: "STATUS_CHANGE",
    entity: "events",
    entityId: id,
    changes: {
      action,
      from: event.status,
      to: rule.to,
      ...(data.publishAt && { publishAt: data.publishAt }),
      ...(body.reason && { reason: body.reason }),
    },
    req,
  });

  if (action === "publish") {
    domainEvents.emit("event.published", { eventId: id, notifyOnPublish: event.notifyOnPublish, reason: "manual", adminId: req?.user?.id });
  } else if (action === "cancel") {
    domainEvents.emit("event.cancelled", { eventId: id, adminId: req?.user?.id });
  }

  return toAdminDto(await prismaRaw.event.findUnique({ where: { id }, include: INCLUDE }), now);
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration
// ---------------------------------------------------------------------------
// Un événement visible du public (publié, annulé) ne se supprime pas directement :
// dépubliez ou archivez-le d'abord, pour éviter de retirer un contenu en ligne par erreur.
const DELETABLE = ["DRAFT", "SCHEDULED", "ARCHIVED"];

export async function remove(id, req) {
  const event = await loadActive(id);
  if (!DELETABLE.includes(event.status)) {
    throw new AppError(`Suppression impossible depuis le statut ${event.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  }
  await prisma.event.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: "events", entityId: id, changes: { status: event.status }, req });
}

export async function restore(id, req) {
  const event = await prismaRaw.event.findFirst({ where: { id, deletedAt: { not: null } }, include: INCLUDE });
  if (!event) throw new AppError("Événement introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);

  // Un événement programmé ne reprend pas sa programmation à la restauration (il serait publié aussitôt).
  const data = { deletedAt: null, ...(event.status === "SCHEDULED" && { status: "DRAFT", publishAt: null }) };
  const restored = await prismaRaw.event.update({ where: { id }, data, include: INCLUDE });

  await auditService.record({ action: "RESTORE", entity: "events", entityId: id, changes: { status: restored.status }, req });
  return toAdminDto(restored);
}

export { computeState };
