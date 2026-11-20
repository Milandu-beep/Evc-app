import prisma, { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { slugify, SLUG_PATTERN } from "../../utils/slug.js";
import * as auditService from "../audit.service.js";
import { applyTranslationOps, assertCoverImage, diffScalars, invalid, mapUniqueViolation, pageMeta, planTranslations } from "../content/common.js";
import { PUBLISH_TRANSITIONS, canPublishTransition } from "../content/simpleLifecycle.js";
import { PERSON_INCLUDE, toAdminPersonDto } from "./person.dto.js";

const ENTITY = "people";
const TEXT_FIELDS = ["title", "bio"];
const SCALAR_FIELDS = ["firstName", "lastName", "slug", "categories", "sortOrder", "photoId"];

// Slug unique (toute la table, supprimés compris : l'unicité en base les couvre).
async function uniqueSlug(base, excludeId = null) {
  const taken = async (slug) => !!(await prismaRaw.person.findFirst({ where: { slug, ...(excludeId && { NOT: { id: excludeId } }) }, select: { id: true } }));
  let candidate = base;
  for (let n = 2; await taken(candidate); n += 1) {
    candidate = `${base}-${n}`;
    if (n > 200) throw new AppError("Impossible de générer un identifiant d'URL unique", 500);
  }
  return candidate;
}

async function assertSlugFree(slug, excludeId = null) {
  if (!SLUG_PATTERN.test(slug)) throw invalid("slug", "slug : minuscules, chiffres et tirets");
  const clash = await prismaRaw.person.findFirst({ where: { slug, ...(excludeId && { NOT: { id: excludeId } }) }, select: { id: true } });
  if (clash) throw new AppError("Identifiant d'URL déjà utilisé", HTTP_STATUS.CONFLICT, [{ field: "slug", message: "Déjà utilisé" }]);
}

async function loadActive(id) {
  const p = await prisma.person.findUnique({ where: { id }, include: PERSON_INCLUDE });
  if (!p) throw new AppError("Personne introuvable", HTTP_STATUS.NOT_FOUND);
  return p;
}

const uniqueCategories = (list) => [...new Set(list ?? [])];

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
export async function list(query) {
  const { page, limit, q, status, category, deleted, sort, order } = query;
  const and = [];
  if (status) and.push({ status });
  if (category) and.push({ categories: { has: category } });
  if (q) {
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { translations: { some: { OR: ["title", "bio"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } },
      ],
    });
  }
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };
  const [total, rows] = await Promise.all([
    prismaRaw.person.count({ where }),
    prismaRaw.person.findMany({ where, include: PERSON_INCLUDE, orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map(toAdminPersonDto), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const p = await prismaRaw.person.findUnique({ where: { id }, include: PERSON_INCLUDE });
  if (!p) throw new AppError("Personne introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminPersonDto(p);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations = {}, ...fields } = input;
  await assertCoverImage(fields.photoId);
  const slug = fields.slug ?? (await uniqueSlug(slugify(`${fields.firstName} ${fields.lastName}`, { fallback: "personne" })));
  if (fields.slug) await assertSlugFree(slug);

  const rows = Object.entries(translations)
    .filter(([, t]) => t)
    .map(([language, t]) => ({ language, title: t.title ?? null, bio: t.bio ?? null }))
    .filter((r) => r.title || r.bio);

  let person;
  try {
    person = await prismaRaw.person.create({
      data: {
        firstName: fields.firstName,
        lastName: fields.lastName,
        slug,
        categories: uniqueCategories(fields.categories),
        sortOrder: fields.sortOrder ?? 0,
        photoId: fields.photoId ?? null,
        createdById: req.user.id,
        translations: { create: rows },
      },
      include: PERSON_INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }
  await auditService.record({ action: "CREATE", entity: ENTITY, entityId: person.id, changes: { name: `${fields.firstName} ${fields.lastName}`, categories: person.categories, languages: rows.map((r) => r.language) }, req });
  return toAdminPersonDto(person);
}

// ---------------------------------------------------------------------------
// Modification (champs et traductions ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") throw new AppError("Fiche archivée : désarchivez-la avant de la modifier", HTTP_STATUS.CONFLICT);
  const { translations = {}, ...fields } = input;

  if ("photoId" in fields && fields.photoId !== current.photoId) await assertCoverImage(fields.photoId);
  if (fields.slug && fields.slug !== current.slug) await assertSlugFree(fields.slug, id);
  if ("categories" in fields) fields.categories = uniqueCategories(fields.categories);

  const scalarChanges = diffScalars(current, { ...current, ...fields }, SCALAR_FIELDS);
  const plan = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: [],
    slugTools: null,
    parentId: id,
    requireDefault: false,
  });
  // Pas de traduction vide
  const ops = plan.ops.filter((op) => op.kind !== "create" || TEXT_FIELDS.some((f) => op.data[f]));
  for (const key of Object.keys(plan.changes)) if (plan.changes[key] === "created" && !ops.some((o) => o.kind === "create" && o.data.language === key)) delete plan.changes[key];

  // categories : comparaison de tableaux
  if (scalarChanges.categories && JSON.stringify([...current.categories].sort()) === JSON.stringify([...fields.categories].sort())) delete scalarChanges.categories;
  if (!Object.keys(scalarChanges).length && !ops.length) return toAdminPersonDto(current);

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.personTranslation, ops, "personId", id);
      return tx.person.update({
        where: { id },
        data: Object.fromEntries(SCALAR_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k] ?? null])),
        include: PERSON_INCLUDE,
      });
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }
  await auditService.record({ action: "UPDATE", entity: ENTITY, entityId: id, changes: { fields: scalarChanges, translations: plan.changes }, req });
  return toAdminPersonDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions : publish, unpublish, archive, unarchive
// ---------------------------------------------------------------------------
export async function transition(id, action, req) {
  const rule = PUBLISH_TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);
  const person = await loadActive(id);
  if (!canPublishTransition(action, person.status)) {
    throw new AppError(`Action « ${action} » impossible depuis le statut ${person.status} (statuts autorisés : ${rule.from.join(", ")})`, HTTP_STATUS.CONFLICT);
  }
  const data = { status: rule.to, ...(action === "publish" && { publishedAt: person.publishedAt ?? new Date() }) };
  const { count } = await prismaRaw.person.updateMany({ where: { id, status: person.status, deletedAt: null }, data });
  if (!count) throw new AppError("La fiche a été modifiée entre-temps, rechargez-la", HTTP_STATUS.CONFLICT);
  await auditService.record({ action: "STATUS_CHANGE", entity: ENTITY, entityId: id, changes: { action, from: person.status, to: rule.to }, req });
  return toAdminPersonDto(await prismaRaw.person.findUnique({ where: { id }, include: PERSON_INCLUDE }));
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration. Une personne qui intervient dans une prédication ne se supprime pas.
// ---------------------------------------------------------------------------
const DELETABLE = ["DRAFT", "ARCHIVED"];

export async function remove(id, req) {
  const person = await loadActive(id);
  if (!DELETABLE.includes(person.status)) {
    throw new AppError(`Suppression impossible depuis le statut ${person.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  }
  const sermons = await prismaRaw.sermonSpeaker.count({ where: { personId: id, sermon: { deletedAt: null } } });
  if (sermons > 0) {
    throw new AppError("Cette personne intervient dans des prédications : retirez-la d'abord de chacune", HTTP_STATUS.CONFLICT, { sermons });
  }
  await prisma.person.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { status: person.status }, req });
}

export async function restore(id, req) {
  const person = await prismaRaw.person.findFirst({ where: { id, deletedAt: { not: null } }, include: PERSON_INCLUDE });
  if (!person) throw new AppError("Personne introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const restored = await prismaRaw.person.update({ where: { id }, data: { deletedAt: null }, include: PERSON_INCLUDE });
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { status: restored.status }, req });
  return toAdminPersonDto(restored);
}
