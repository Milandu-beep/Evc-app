import { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { pageMeta } from "../content/common.js";
import { toPublicDetailDto, toPublicListDto } from "./news.dto.js";
import { publicVisibility } from "./news.state.js";

const INCLUDE = { translations: true, coverImage: true };

// Liste publique : actualités publiées (ou programmées et échues), les plus récentes d'abord.
export async function list({ lang, q, featured, from, to, page, limit }, now = new Date()) {
  const and = [publicVisibility(now)];
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (from) and.push({ publishedAt: { gte: from } });
  if (to) and.push({ publishedAt: { lte: to } });
  if (q) {
    and.push({
      translations: {
        some: { OR: ["title", "excerpt", "content"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) },
      },
    });
  }
  const where = { deletedAt: null, AND: and };

  const [total, rows] = await Promise.all([
    prismaRaw.news.count({ where }),
    prismaRaw.news.findMany({
      where,
      include: INCLUDE,
      // Une actualité programmée vient d'être publiée : sa date effective n'est pas encore écrite (≤ 1 min),
      // elle est la plus récente, donc en tête.
      orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { items: rows.map((n) => toPublicListDto(n, lang)), meta: pageMeta(page, limit, total) };
}

// Détail par identifiant d'URL, dans la langue demandée.
export async function getBySlug(slug, lang, now = new Date()) {
  const translation = await prismaRaw.newsTranslation.findFirst({
    where: { slug, language: lang, news: { deletedAt: null, AND: [publicVisibility(now)] } },
    include: { news: { include: INCLUDE } },
  });
  if (!translation) throw new AppError("Actualité introuvable", HTTP_STATUS.NOT_FOUND);
  return toPublicDetailDto(translation.news, lang);
}
