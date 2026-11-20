import { prismaRaw } from "../../config/prisma.js";
import { DEFAULT_LANGUAGE, HTTP_STATUS, LANGUAGES } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import env from "../../config/env.js";
import { startOfLocalDay, startOfLocalMonth } from "../../utils/timezone.js";
import { pageMeta } from "../content/common.js";
import { toCalendarDto, toPublicDto } from "./event.dto.js";
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
export async function list({ lang, q, type, when, featured, page, limit }, now = new Date()) {
  const and = [publicVisibility(now)];
  if (type) and.push({ type });
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
    meta: pageMeta(page, limit, total),
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

// ---------------------------------------------------------------------------
// Calendrier : événements visibles qui chevauchent la période [from, to[
// ---------------------------------------------------------------------------
export const CALENDAR_LIMIT = 500;

// Période demandée : un mois (« AAAA-MM », mois local de l'église) ou une plage from/to.
export function calendarRange({ month, from, to }) {
  if (month) {
    const [y, m] = month.split("-").map(Number);
    return { from: startOfLocalMonth(y, m, env.timeZone), to: startOfLocalMonth(y, m, env.timeZone, 1) };
  }
  return { from, to };
}

export async function calendar({ lang, type, month, from, to }, now = new Date()) {
  const range = calendarRange({ month, from, to });
  // Chevauchement : commence avant la fin de la période ET finit après son début. Sans fin renseignée,
  // l'événement finit à 23 h 59 de son jour de début, donc il compte si ce jour n'est pas avant `from`.
  const and = [
    publicVisibility(now),
    { startsAt: { lt: range.to } },
    { OR: [{ endsAt: { gte: range.from } }, { endsAt: null, startsAt: { gte: startOfLocalDay(range.from, env.timeZone) } }] },
  ];
  if (type) and.push({ type });

  const rows = await prismaRaw.event.findMany({
    where: { deletedAt: null, AND: and },
    include: INCLUDE,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: CALENDAR_LIMIT + 1,
  });
  const truncated = rows.length > CALENDAR_LIMIT;
  const items = rows.slice(0, CALENDAR_LIMIT).map((e) => toCalendarDto(e, lang, now));
  return { from: range.from, to: range.to, count: items.length, truncated, items };
}
