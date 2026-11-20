// Filtres de recherche des prédications, communs à l'administration et à la lecture publique.
import { prismaRaw } from "../../config/prisma.js";
import { dateOnlyToUtc } from "../../utils/timezone.js";
import { normalizeTag, parseTagFilter, tagsWhere } from "../content/tags.js";

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Prédications dont l'une des références de versets contient le texte cherché (ex. « jean 3 » -> « Jean 3:16 »).
// Recherche SQL, car Prisma ne sait pas chercher « contient » dans un tableau de textes.
export async function sermonIdsByVerse(term) {
  const rows = await prismaRaw.$queryRaw`
    SELECT DISTINCT st."sermonId" AS id
      FROM "sermon_translations" st, unnest(st."verseReferences") AS v
     WHERE v ILIKE ${"%" + escapeLike(term) + "%"}
     LIMIT 2000`;
  return rows.map((r) => r.id);
}

/**
 * Clauses « AND » Prisma pour les filtres d'une liste de prédications.
 * q (titre, description, thème, slug, tag, intervenant, titre de série, verset), tags (+ match), theme, seriesId,
 * series (slug), speakerId (+ role), featured, from/to (dates AAAA-MM-JJ), hasAudio, hasVideo, verse.
 */
export async function sermonFilters(f) {
  const and = [];
  if (f.featured !== undefined) and.push({ isFeatured: f.featured });
  if (f.from) and.push({ date: { gte: dateOnlyToUtc(f.from) } });
  if (f.to) and.push({ date: { lte: dateOnlyToUtc(f.to) } });
  if (f.hasAudio) and.push({ audioFileId: { not: null } });
  if (f.hasVideo) and.push({ OR: [{ videoFileId: { not: null } }, { youtubeId: { not: null } }] });
  if (f.theme) and.push({ translations: { some: { theme: { equals: f.theme, mode: "insensitive" } } } });
  if (f.seriesId) and.push({ seriesId: f.seriesId });
  if (f.series) {
    const t = await prismaRaw.sermonSeriesTranslation.findFirst({ where: { slug: f.series }, select: { seriesId: true } });
    and.push({ seriesId: t?.seriesId ?? "00000000-0000-0000-0000-000000000000" }); // série inconnue : aucun résultat
  }
  if (f.speakerId) and.push({ speakers: { some: { personId: f.speakerId, ...(f.role && { role: f.role }) } } });
  const tags = parseTagFilter(f.tags);
  if (tags.length) and.push(tagsWhere(tags, f.match));
  if (f.verse) and.push({ id: { in: await sermonIdsByVerse(f.verse) } });
  if (f.q) {
    const tag = normalizeTag(f.q);
    and.push({
      OR: [
        { translations: { some: { OR: ["title", "description", "theme", "slug"].map((c) => ({ [c]: { contains: f.q, mode: "insensitive" } })) } } },
        ...(tag ? [{ tags: { has: tag } }] : []),
        { speakers: { some: { person: { OR: ["firstName", "lastName"].map((c) => ({ [c]: { contains: f.q, mode: "insensitive" } })) } } } },
        { series: { translations: { some: { title: { contains: f.q, mode: "insensitive" } } } } },
        { id: { in: await sermonIdsByVerse(f.q) } },
      ],
    });
  }
  return and;
}
