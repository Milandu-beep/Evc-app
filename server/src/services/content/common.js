// Briques communes aux contenus publiables multilingues (événements, actualités) :
// slugs uniques par langue, planification des traductions, métadonnées de pagination.
import prisma, { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { slugify } from "../../utils/slug.js";

export const invalid = (field, message) =>
  new AppError("Données invalides", HTTP_STATUS.UNPROCESSABLE, [{ field, message }]);

// Violation d'unicité (slug) -> 409 plutôt qu'une erreur 500.
export const mapUniqueViolation = (err) =>
  err?.code === "P2002" ? new AppError("Conflit : identifiant d'URL déjà utilisé", HTTP_STATUS.CONFLICT) : err;

export const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });

// Égalité de valeurs scalaires, dates comprises.
export const sameValue = (a, b) => (a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : a === b);

// Champs scalaires modifiés : { champ: { from, to } } (pour le journal d'audit).
export function diffScalars(before, after, keys) {
  const changes = {};
  for (const key of keys) {
    if (!sameValue(before[key] ?? null, after[key] ?? null)) {
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return changes;
}

/**
 * Outils de slug pour une table de traductions.
 *  delegateName : « eventTranslation » ou « newsTranslation » ; parentKey : « eventId » ou « newsId ».
 *  reserved : slugs interdits (ex. « calendar », réservé à une route).
 * Les lignes supprimées logiquement comptent : l'unicité en base les couvre aussi.
 */
export function makeSlugTools(delegateName, parentKey, { reserved = [] } = {}) {
  const taken = async (language, slug, excludeParentId) =>
    reserved.includes(slug) ||
    !!(await prismaRaw[delegateName].findFirst({
      where: { language, slug, ...(excludeParentId && { NOT: { [parentKey]: excludeParentId } }) },
      select: { id: true },
    }));

  return {
    // Slug généré depuis un titre : suffixe -2, -3… en cas de doublon.
    async uniqueSlug(language, title, excludeParentId = null) {
      const base = slugify(title);
      let candidate = base;
      for (let n = 2; await taken(language, candidate, excludeParentId); n += 1) {
        candidate = `${base}-${n}`;
        if (n > 200) throw new AppError("Impossible de générer un identifiant d'URL unique", 500);
      }
      return candidate;
    },
    // Slug fourni par l'administrateur : refusé s'il est réservé (422) ou déjà pris (409).
    async assertSlugFree(language, slug, excludeParentId = null) {
      if (reserved.includes(slug)) throw invalid(`translations.${language}.slug`, `« ${slug} » est un identifiant réservé`);
      if (await taken(language, slug, excludeParentId)) {
        throw new AppError("Identifiant d'URL déjà utilisé", HTTP_STATUS.CONFLICT, [
          { field: `translations.${language}.slug`, message: "Déjà utilisé dans cette langue" },
        ]);
      }
    },
  };
}

const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] ?? null]));

/**
 * Lignes de traduction à la création. Le français est obligatoire.
 *  textFields : champs de texte de la table (ex. ["title", "description", "location"]).
 */
export async function buildCreateRows(translations, { textFields, slugTools }) {
  const rows = [];
  for (const [language, t] of Object.entries(translations)) {
    if (!t) continue;
    if (!slugTools) {
      rows.push({ language, ...pick(t, textFields) }); // contenu sans slug (ex. message du jour : l'URL est sa date)
      continue;
    }
    const slug = t.slug ?? (await slugTools.uniqueSlug(language, t.title));
    if (t.slug) await slugTools.assertSlugFree(language, slug);
    rows.push({ language, slug, ...pick(t, textFields) });
  }
  if (!rows.some((r) => r.language === DEFAULT_LANGUAGE)) {
    throw invalid(`translations.${DEFAULT_LANGUAGE}`, "La traduction française est obligatoire");
  }
  return rows;
}

/**
 * Plan de modification des traductions d'un contenu : upsert par langue, « null » supprime une langue
 * (sauf le français). Retourne { ops, changes } : les opérations à exécuter et un résumé pour l'audit
 * qui ne contient JAMAIS le texte, seulement les noms des champs modifiés.
 */
export async function planTranslations({ existingByLang, translations, textFields, requiredOnCreate, slugTools, parentId, requireDefault = true }) {
  const ops = [];
  const changes = {};

  for (const [language, t] of Object.entries(translations)) {
    const existing = existingByLang[language];

    if (t === null) {
      if (requireDefault && language === DEFAULT_LANGUAGE) throw invalid(`translations.${language}`, "La traduction française ne peut pas être supprimée");
      if (existing) {
        ops.push({ kind: "delete", id: existing.id });
        changes[language] = "deleted";
      }
      continue;
    }

    if (!existing) {
      const missing = requiredOnCreate.filter((f) => !t[f]);
      if (missing.length) throw invalid(`translations.${language}`, `${missing.join(" et ")} requis pour créer une traduction`);
      if (!slugTools) {
        ops.push({ kind: "create", data: { language, ...pick(t, textFields) } });
        changes[language] = "created";
        continue;
      }
      const slug = t.slug ?? (await slugTools.uniqueSlug(language, t.title, parentId));
      if (t.slug) await slugTools.assertSlugFree(language, slug, parentId);
      ops.push({ kind: "create", data: { language, slug, ...pick(t, textFields) } });
      changes[language] = "created";
      continue;
    }

    const data = {};
    for (const key of textFields) {
      if (key in t && (t[key] ?? null) !== (existing[key] ?? null)) data[key] = t[key] ?? null;
    }
    if (slugTools && t.slug && t.slug !== existing.slug) {
      await slugTools.assertSlugFree(language, t.slug, parentId);
      data.slug = t.slug;
    }
    if (Object.keys(data).length) {
      ops.push({ kind: "update", id: existing.id, data });
      changes[language] = { updated: Object.keys(data) };
    }
  }
  return { ops, changes };
}

// Applique le plan dans une transaction (delegate = tx.eventTranslation ou tx.newsTranslation).
export async function applyTranslationOps(delegate, ops, parentKey, parentId) {
  for (const op of ops) {
    if (op.kind === "delete") await delegate.delete({ where: { id: op.id } });
    else if (op.kind === "update") await delegate.update({ where: { id: op.id }, data: op.data });
    else await delegate.create({ data: { ...op.data, [parentKey]: parentId } });
  }
}

// Image de couverture : fichier prêt (READY), de type image, non supprimé.
export async function assertCoverImage(id) {
  if (!id) return;
  const file = await prisma.storageFile.findUnique({ where: { id } });
  if (!file || file.status !== "READY" || file.resourceType !== "IMAGE") {
    throw invalid("coverImageId", "Fichier introuvable, non prêt ou n'étant pas une image");
  }
}
