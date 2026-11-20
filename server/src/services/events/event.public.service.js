import { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS, LANGUAGES } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { toPublicDto } from "./event.dto.js";
import { endedWhere, notEndedWhere, publicVisibility } from "./event.state.js";

const INCLUDE = { translations: true, coverImage: true };
const SUPPORTED = Object.values(LANGUAGES);

// Langue demandée : ?lang=, sinon en-tête Accept-Language, sinon français.
export function resolveLanguage(req) {
  const asked = String(req.query?.lang ?? "").toLowerCase();
  if (SUPPORTED.includes(asked)) return asked;
  const header = String(req.headers?.["accept-language"] ?? "");
  for (const part of header.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}

// Liste publique : événements publiés (ou programmés et échus) et annulés après publication.
export async function list({ lang, q, when, featured, page, limit }, now = new Date()) {
  const and = [publicVisibility(now)];
  if (when === "upcoming") and.push(notEndedWhere(now));
  if (when === "past") and.push(endedWhere(now));
  if (featured !== undefined) and.push({ isFeatured: featured });
  if (q) {
    and.push({
      translations: {
        some: { OR: ["title", "description", "location"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) },
      },
    });
  }
  const where = { deletedAt: null, AND: and };
  const direction = when === "upcoming" ? "asc" : "desc"; // à venir : le plus proche d'abord

  const [total, rows] = await Promise.all([
    prismaRaw.event.count({ where }),
    prismaRaw.event.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ startsAt: direction }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return {
    items: rows.map((e) => toPublicDto(e, lang, now)),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Détail par identifiant d'URL, dans la langue demandée.
export async function getBySlug(slug, lang, now = new Date()) {
  const translation = await prismaRaw.eventTranslation.findFirst({
    where: { slug, language: lang, event: { deletedAt: null, AND: [publicVisibility(now)] } },
    include: { event: { include: INCLUDE } },
  });
  if (!translation) throw new AppError("Événement introuvable", HTTP_STATUS.NOT_FOUND);
  return toPublicDto(translation.event, lang, now);
}
