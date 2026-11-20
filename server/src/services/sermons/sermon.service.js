import prisma, { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { domainEvents } from "../../utils/domainEvents.js";
import { dateOnlyToUtc } from "../../utils/timezone.js";
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
import { TRANSITIONS, canTransition, stateWhere } from "../content/lifecycle.js";
import { normalizeTags } from "../content/tags.js";
import { dateString } from "../dailyMessages/dailyMessage.state.js";
import { urlFor } from "../storage/storage.service.js";
import { SERMON_INCLUDE, toAdminSermonDto } from "./sermon.dto.js";
import {
  MAX_DOCUMENTS,
  MAX_SPEAKERS,
  assertAudioFile,
  assertPdfFile,
  assertVideoFile,
  baseName,
  normalizeVerses,
  parseYoutubeId,
} from "./sermon.common.js";
import { sermonFilters } from "./sermon.filters.js";

const ENTITY = "sermons";
const TEXT_FIELDS = ["title", "description", "theme", "verseReferences"];
const SCALAR_FIELDS = ["date", "seriesId", "seriesPosition", "coverImageId", "audioFileId", "videoFileId", "youtubeId", "isFeatured", "notifyOnPublish", "tags"];
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
const slugTools = makeSlugTools("sermonTranslation", "sermonId");

async function loadActive(id) {
  const s = await prisma.sermon.findUnique({ where: { id }, include: SERMON_INCLUDE });
  if (!s) throw new AppError("Prédication introuvable", HTTP_STATUS.NOT_FOUND);
  return s;
}

async function assertSeries(id) {
  if (!id) return;
  const series = await prisma.sermonSeries.findUnique({ where: { id }, select: { id: true } });
  if (!series) throw invalid("seriesId", "Série introuvable");
}

// Intervenants : « speakers » (plusieurs, avec rôle) ou « preacherId » (raccourci : un seul prédicateur).
// Retourne null si aucun des deux n'est fourni (= ne pas toucher aux intervenants).
async function resolveSpeakers(input) {
  let list = null;
  if (input.speakers !== undefined && input.preacherId !== undefined) throw invalid("speakers", "Utilisez speakers OU preacherId, pas les deux");
  if (input.speakers !== undefined) list = input.speakers;
  else if (input.preacherId !== undefined) list = input.preacherId ? [{ personId: input.preacherId, role: "PREACHER" }] : [];
  if (list === null) return null;
  if (list.length > MAX_SPEAKERS) throw invalid("speakers", `${MAX_SPEAKERS} intervenants au plus`);

  const speakers = list.map((x, position) => ({ personId: x.personId, role: x.role ?? "PREACHER", position }));
  const keys = speakers.map((x) => `${x.personId}:${x.role}`);
  if (new Set(keys).size !== keys.length) throw invalid("speakers", "Une personne ne peut pas avoir deux fois le même rôle");
  const ids = [...new Set(speakers.map((x) => x.personId))];
  const found = await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((p) => p.id === id));
  if (missing.length) throw invalid("speakers", `Personne(s) introuvable(s) : ${missing.join(", ")}`);
  return speakers;
}

// Vidéo : hébergée OU lien YouTube (pas les deux). youtubeUrl -> identifiant.
function resolveVideoFields(input, current = {}) {
  const out = {};
  if ("youtubeUrl" in input) {
    if (input.youtubeUrl === null) out.youtubeId = null;
    else {
      const id = parseYoutubeId(input.youtubeUrl);
      if (!id) throw invalid("youtubeUrl", "Lien YouTube non reconnu (youtu.be/…, youtube.com/watch?v=…, /embed/…, /shorts/…)");
      out.youtubeId = id;
    }
  }
  const nextVideo = "videoFileId" in input ? input.videoFileId : current.videoFileId;
  const nextYoutube = "youtubeId" in out ? out.youtubeId : current.youtubeId;
  if (nextVideo && nextYoutube) throw invalid("youtubeUrl", "Une prédication a une vidéo hébergée OU un lien YouTube : retirez l'un des deux");
  return out;
}

function resolveSeriesFields(input, current = {}) {
  const out = {};
  const nextSeries = "seriesId" in input ? input.seriesId : current.seriesId;
  if ("seriesId" in input && !input.seriesId) out.seriesPosition = null; // sans série, pas de numéro
  const nextPosition = out.seriesPosition !== undefined ? out.seriesPosition : "seriesPosition" in input ? input.seriesPosition : current.seriesPosition;
  if (nextPosition != null && !nextSeries) throw invalid("seriesPosition", "Un numéro de série exige une série");
  return out;
}

const withVerses = (data) => ({ ...data, ...("verseReferences" in data && { verseReferences: normalizeVerses(data.verseReferences) }) });

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------
export async function list(query, now = new Date()) {
  const { page, limit, state, deleted, sort, order } = query;
  const and = await sermonFilters(query);
  if (state) and.push(stateWhere(state, now));
  const where = { deletedAt: deleted ? { not: null } : null, ...(and.length && { AND: and }) };
  const [total, rows] = await Promise.all([
    prismaRaw.sermon.count({ where }),
    prismaRaw.sermon.findMany({ where, include: SERMON_INCLUDE, orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((s) => toAdminSermonDto(s, now)), meta: pageMeta(page, limit, total) };
}

export async function getById(id) {
  const s = await prismaRaw.sermon.findUnique({ where: { id }, include: SERMON_INCLUDE });
  if (!s) throw new AppError("Prédication introuvable", HTTP_STATUS.NOT_FOUND);
  return toAdminSermonDto(s);
}

// Tags utilisés (prédications non supprimées), avec leur nombre d'usages.
export async function tags() {
  return prismaRaw.$queryRaw`
    SELECT t AS tag, count(*)::int AS count FROM "sermons" s, unnest(s."tags") AS t
     WHERE s."deletedAt" IS NULL GROUP BY t ORDER BY count DESC, t ASC LIMIT 500`;
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------
export async function create(input, req) {
  const { translations, ...fields } = input;
  await Promise.all([assertCoverImage(fields.coverImageId), assertAudioFile(fields.audioFileId), assertVideoFile(fields.videoFileId), assertSeries(fields.seriesId)]);
  const video = resolveVideoFields(fields);
  resolveSeriesFields(fields);
  const speakers = (await resolveSpeakers(fields)) ?? [];
  const tags = normalizeTags(fields.tags);
  const rows = (await buildCreateRows(translations, { textFields: TEXT_FIELDS, slugTools, arrayFields: ["verseReferences"] })).map(withVerses);

  let sermon;
  try {
    sermon = await prismaRaw.sermon.create({
      data: {
        date: dateOnlyToUtc(fields.date),
        seriesId: fields.seriesId ?? null,
        seriesPosition: fields.seriesPosition ?? null,
        coverImageId: fields.coverImageId ?? null,
        audioFileId: fields.audioFileId ?? null,
        videoFileId: fields.videoFileId ?? null,
        youtubeId: video.youtubeId ?? null,
        isFeatured: fields.isFeatured ?? false,
        notifyOnPublish: fields.notifyOnPublish ?? false,
        tags,
        createdById: req.user.id,
        translations: { create: rows },
        speakers: { create: speakers },
      },
      include: SERMON_INCLUDE,
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }
  await auditService.record({
    action: "CREATE",
    entity: ENTITY,
    entityId: sermon.id,
    changes: { status: sermon.status, date: dateString(sermon.date), languages: rows.map((r) => r.language), speakers: speakers.length, seriesId: sermon.seriesId },
    req,
  });
  return toAdminSermonDto(sermon);
}

// ---------------------------------------------------------------------------
// Modification : champs, tags, intervenants (remplacés) et traductions (upsert par langue ; null supprime une langue)
// ---------------------------------------------------------------------------
export async function update(id, input, req) {
  const current = await loadActive(id);
  if (current.status === "ARCHIVED") throw new AppError("Prédication archivée : désarchivez-la avant de la modifier", HTTP_STATUS.CONFLICT);
  const { translations = {}, speakers: _s, preacherId: _p, ...rest } = input;
  const fields = { ...rest };

  if ("coverImageId" in fields && fields.coverImageId !== current.coverImageId) await assertCoverImage(fields.coverImageId);
  if ("audioFileId" in fields && fields.audioFileId !== current.audioFileId) await assertAudioFile(fields.audioFileId);
  if ("videoFileId" in fields && fields.videoFileId !== current.videoFileId) await assertVideoFile(fields.videoFileId);
  if ("seriesId" in fields && fields.seriesId !== current.seriesId) await assertSeries(fields.seriesId);
  Object.assign(fields, resolveVideoFields(fields, current), resolveSeriesFields(fields, current));
  delete fields.youtubeUrl;
  if ("tags" in fields) fields.tags = normalizeTags(fields.tags);

  const speakers = await resolveSpeakers(input);
  const next = { ...current, ...fields, ...(fields.date && { date: dateOnlyToUtc(fields.date) }) };
  const scalarChanges = diffScalars(current, next, SCALAR_FIELDS.filter((k) => k !== "tags"));
  if (scalarChanges.date) scalarChanges.date = { from: dateString(current.date), to: fields.date };
  const tagsChanged = "tags" in fields && JSON.stringify(fields.tags) !== JSON.stringify(current.tags);
  if (tagsChanged) scalarChanges.tags = { from: current.tags, to: fields.tags };

  const plan = await planTranslations({
    existingByLang: Object.fromEntries(current.translations.map((t) => [t.language, t])),
    translations,
    textFields: TEXT_FIELDS,
    requiredOnCreate: ["title"],
    slugTools,
    parentId: id,
    arrayFields: ["verseReferences"],
  });
  const ops = plan.ops.map((op) => (op.kind === "delete" ? op : { ...op, data: withVerses(op.data) }));

  const currentSpeakers = current.speakers.map((x) => ({ personId: x.personId, role: x.role }));
  const speakersChanged = speakers && JSON.stringify(speakers.map((x) => ({ personId: x.personId, role: x.role }))) !== JSON.stringify(currentSpeakers);
  if (!Object.keys(scalarChanges).length && !ops.length && !speakersChanged) return toAdminSermonDto(current);

  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      await applyTranslationOps(tx.sermonTranslation, ops, "sermonId", id);
      if (speakersChanged) {
        await tx.sermonSpeaker.deleteMany({ where: { sermonId: id } });
        await tx.sermonSpeaker.createMany({ data: speakers.map((x) => ({ ...x, sermonId: id })) });
      }
      const data = {};
      for (const key of SCALAR_FIELDS) if (key in fields) data[key] = key === "date" ? dateOnlyToUtc(fields.date) : (fields[key] ?? null);
      if ("youtubeId" in fields) data.youtubeId = fields.youtubeId;
      return tx.sermon.update({ where: { id }, data, include: SERMON_INCLUDE });
    });
  } catch (err) {
    throw mapUniqueViolation(err);
  }

  await auditService.record({
    action: "UPDATE",
    entity: ENTITY,
    entityId: id,
    changes: { fields: scalarChanges, translations: plan.changes, ...(speakersChanged && { speakers: { from: currentSpeakers, to: speakers.map((x) => ({ personId: x.personId, role: x.role })) } }) },
    req,
  });
  return toAdminSermonDto(updated);
}

// ---------------------------------------------------------------------------
// Transitions : publish, schedule, unpublish, archive, unarchive
// ---------------------------------------------------------------------------
export async function transition(id, action, body = {}, req) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new AppError("Action inconnue", HTTP_STATUS.BAD_REQUEST);
  const s = await loadActive(id);
  if (!canTransition(action, s.status)) {
    throw new AppError(`Action « ${action} » impossible depuis le statut ${s.status} (statuts autorisés : ${rule.from.join(", ")})`, HTTP_STATUS.CONFLICT);
  }

  const now = new Date();
  const data = { status: rule.to };
  if (action === "publish" || action === "schedule") {
    const fr = s.translations.find((t) => t.language === DEFAULT_LANGUAGE);
    if (!fr?.title) throw invalid(`translations.${DEFAULT_LANGUAGE}`, "Titre français requis pour publier");
    if (!s.audioFileId && !s.videoFileId && !s.youtubeId) throw invalid("media", "Une prédication publiée a au moins un média : audio, vidéo ou lien YouTube");
  }
  if (action === "publish") {
    Object.assign(data, { publishAt: null, publishedAt: s.publishedAt ?? now });
  } else if (action === "schedule") {
    const publishAt = body.publishAt;
    if (!publishAt || publishAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) throw invalid("publishAt", "La publication programmée doit être au moins 1 minute dans le futur");
    data.publishAt = publishAt;
  } else {
    data.publishAt = null;
  }

  const { count } = await prismaRaw.sermon.updateMany({ where: { id, status: s.status, deletedAt: null }, data });
  if (!count) throw new AppError("La prédication a été modifiée entre-temps, rechargez-la", HTTP_STATUS.CONFLICT);

  await auditService.record({ action: "STATUS_CHANGE", entity: ENTITY, entityId: id, changes: { action, from: s.status, to: rule.to, ...(data.publishAt && { publishAt: data.publishAt }) }, req });
  if (action === "publish") {
    domainEvents.emit("sermon.published", { sermonId: id, notifyOnPublish: s.notifyOnPublish, reason: "manual", adminId: req?.user?.id });
  }
  return toAdminSermonDto(await prismaRaw.sermon.findUnique({ where: { id }, include: SERMON_INCLUDE }), now);
}

// ---------------------------------------------------------------------------
// Suppression logique et restauration
// ---------------------------------------------------------------------------
const DELETABLE = ["DRAFT", "SCHEDULED", "ARCHIVED"];

export async function remove(id, req) {
  const s = await loadActive(id);
  if (!DELETABLE.includes(s.status)) throw new AppError(`Suppression impossible depuis le statut ${s.status} : dépubliez ou archivez d'abord`, HTTP_STATUS.CONFLICT);
  await prisma.sermon.delete({ where: { id } }); // suppression logique (extension du client)
  await auditService.record({ action: "DELETE", entity: ENTITY, entityId: id, changes: { status: s.status }, req });
}

export async function restore(id, req) {
  const s = await prismaRaw.sermon.findFirst({ where: { id, deletedAt: { not: null } }, include: SERMON_INCLUDE });
  if (!s) throw new AppError("Prédication introuvable dans la corbeille", HTTP_STATUS.NOT_FOUND);
  const data = { deletedAt: null, ...(s.status === "SCHEDULED" && { status: "DRAFT", publishAt: null }) };
  const restored = await prismaRaw.sermon.update({ where: { id }, data, include: SERMON_INCLUDE });
  await auditService.record({ action: "RESTORE", entity: ENTITY, entityId: id, changes: { status: restored.status }, req });
  return toAdminSermonDto(restored);
}

// ---------------------------------------------------------------------------
// Documents PDF d'accompagnement
// ---------------------------------------------------------------------------
const DOC_INCLUDE = { translations: true, storageFile: true };

async function loadWritableSermon(id) {
  const s = await prisma.sermon.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!s) throw new AppError("Prédication introuvable", HTTP_STATUS.NOT_FOUND);
  if (s.status === "ARCHIVED") throw new AppError("Prédication archivée : désarchivez-la avant de la modifier", HTTP_STATUS.CONFLICT);
  return s;
}

// documents : [{ storageFileId, translations?: { fr: { title }, en: { title } } }]. Sans titre français, le nom du fichier sert de titre.
export async function addDocuments(sermonId, documents, req) {
  await loadWritableSermon(sermonId);
  if (documents.length > MAX_DOCUMENTS) throw invalid("documents", `${MAX_DOCUMENTS} documents au plus par ajout`);
  const created = [];
  const skipped = [];
  const failed = [];

  await prismaRaw.$transaction(async (tx) => {
    const existing = await tx.sermonDocument.findMany({ where: { sermonId }, select: { storageFileId: true, position: true } });
    const known = new Set(existing.map((d) => d.storageFileId));
    let position = existing.reduce((m, d) => Math.max(m, d.position), -1) + 1;
    for (const doc of documents) {
      let file;
      try {
        file = await assertPdfFile(doc.storageFileId);
      } catch (err) {
        failed.push({ storageFileId: doc.storageFileId, reason: err.details?.[0]?.message ?? err.message });
        continue;
      }
      if (known.has(file.id)) {
        skipped.push({ storageFileId: file.id, reason: "Déjà rattaché à cette prédication" });
        continue;
      }
      const titles = Object.entries(doc.translations ?? {}).filter(([, t]) => t?.title);
      if (!titles.some(([lang]) => lang === DEFAULT_LANGUAGE)) titles.push([DEFAULT_LANGUAGE, { title: baseName(file.originalFilename) }]);
      const row = await tx.sermonDocument.create({
        data: { sermonId, storageFileId: file.id, position, translations: { create: titles.map(([language, t]) => ({ language, title: t.title })) } },
        include: DOC_INCLUDE,
      });
      known.add(file.id);
      position += 1;
      created.push(row);
    }
  });
  if (created.length) await auditService.record({ action: "CREATE", entity: "sermon_documents", changes: { sermonId, count: created.length, documentIds: created.map((d) => d.id) }, req });
  return { created: created.map(adminDocDto), skipped, failed };
}

const adminDocDto = (d) => ({
  id: d.id,
  sermonId: d.sermonId,
  position: d.position,
  fileId: d.storageFileId,
  originalFilename: d.storageFile?.originalFilename,
  bytes: d.storageFile?.bytes,
  url: d.storageFile?.status === "READY" ? urlFor(d.storageFile) : null,
  translations: Object.fromEntries(d.translations.map((t) => [t.language, { title: t.title }])),
});

// Titres d'un document par langue (« null » supprime une langue ; le français reste obligatoire).
export async function updateDocument(docId, { translations = {} }, req) {
  const doc = await prismaRaw.sermonDocument.findUnique({ where: { id: docId }, include: DOC_INCLUDE });
  if (!doc) throw new AppError("Document introuvable", HTTP_STATUS.NOT_FOUND);
  await loadWritableSermon(doc.sermonId);
  const plan = await planTranslations({
    existingByLang: Object.fromEntries(doc.translations.map((t) => [t.language, t])),
    translations,
    textFields: ["title"],
    requiredOnCreate: ["title"],
    slugTools: null,
    parentId: docId,
  });
  if (!plan.ops.length) return adminDocDto(doc);
  const updated = await prismaRaw.$transaction(async (tx) => {
    await applyTranslationOps(tx.sermonDocumentTranslation, plan.ops, "documentId", docId);
    return tx.sermonDocument.findUnique({ where: { id: docId }, include: DOC_INCLUDE });
  });
  await auditService.record({ action: "UPDATE", entity: "sermon_documents", entityId: docId, changes: { translations: plan.changes }, req });
  return adminDocDto(updated);
}

// Retire le lien (le fichier reste dans le stockage : le nettoyage des orphelins s'en charge).
export async function removeDocument(docId, req) {
  const doc = await prismaRaw.sermonDocument.findUnique({ where: { id: docId } });
  if (!doc) throw new AppError("Document introuvable", HTTP_STATUS.NOT_FOUND);
  await loadWritableSermon(doc.sermonId);
  await prismaRaw.sermonDocument.delete({ where: { id: docId } });
  await auditService.record({ action: "DELETE", entity: "sermon_documents", entityId: docId, changes: { sermonId: doc.sermonId, storageFileId: doc.storageFileId }, req });
}

// Ordre des documents : liste exacte (409 si périmée).
export async function reorderDocuments(sermonId, ids, req) {
  await loadWritableSermon(sermonId);
  if (new Set(ids).size !== ids.length) throw invalid("documentIds", "Identifiants en double");
  const current = await prismaRaw.sermonDocument.findMany({ where: { sermonId }, select: { id: true } });
  const known = new Set(current.map((d) => d.id));
  if (known.size !== ids.length || !ids.every((id) => known.has(id))) throw new AppError("Liste de documents périmée : rechargez la prédication puis réessayez", HTTP_STATUS.CONFLICT);
  await prismaRaw.$transaction(ids.map((id, position) => prismaRaw.sermonDocument.update({ where: { id }, data: { position } })));
  await auditService.record({ action: "UPDATE", entity: "sermon_documents", changes: { sermonId, reordered: ids.length }, req });
}
