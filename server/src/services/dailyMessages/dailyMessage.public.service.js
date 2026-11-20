import { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { dateOnlyToUtc } from "../../utils/timezone.js";
import { pageMeta } from "../content/common.js";
import { toPublicDetailDto, toPublicListDto } from "./dailyMessage.dto.js";
import { publicVisibility, todayDate, todayString } from "./dailyMessage.state.js";

const INCLUDE = { translations: true, image: true };

/**
 * Message du jour. Si aucun message publié n'existe pour la date du jour (jour local de l'église),
 * on renvoie automatiquement le DERNIER message publié avec isFallback = true : le frontend peut en
 * informer l'utilisateur (« message du <date> »). 404 seulement s'il n'existe encore aucun message.
 */
export async function getToday(lang, now = new Date()) {
  const requestedDate = todayString(now);

  const exact = await prismaRaw.dailyMessage.findFirst({
    where: { deletedAt: null, date: todayDate(now), AND: [publicVisibility(now)] },
    include: INCLUDE,
  });
  if (exact) return toPublicDetailDto(exact, lang, { isFallback: false, requestedDate });

  const latest = await prismaRaw.dailyMessage.findFirst({
    where: { deletedAt: null, date: { lt: todayDate(now) }, AND: [publicVisibility(now)] },
    include: INCLUDE,
    orderBy: [{ date: "desc" }, { id: "asc" }],
  });
  if (!latest) throw new AppError("Aucun message publié pour le moment", HTTP_STATUS.NOT_FOUND);
  return toPublicDetailDto(latest, lang, { isFallback: true, requestedDate });
}

// Message d'une date donnée « AAAA-MM-JJ » : jamais une date future (pas encore affichable), jamais de repli.
export async function getByDate(date, lang, now = new Date()) {
  if (date > todayString(now)) throw new AppError("Message introuvable", HTTP_STATUS.NOT_FOUND);
  const m = await prismaRaw.dailyMessage.findFirst({
    where: { deletedAt: null, date: dateOnlyToUtc(date), AND: [publicVisibility(now)] },
    include: INCLUDE,
  });
  if (!m) throw new AppError("Message introuvable", HTTP_STATUS.NOT_FOUND);
  return toPublicDetailDto(m, lang, { isFallback: false, requestedDate: date });
}

// Archive : messages affichables (publiés, date atteinte), du plus récent au plus ancien.
export async function list({ lang, q, theme, from, to, page, limit }, now = new Date()) {
  const and = [publicVisibility(now), { date: { lte: todayDate(now) } }];
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
  const where = { deletedAt: null, AND: and };

  const [total, rows] = await Promise.all([
    prismaRaw.dailyMessage.count({ where }),
    prismaRaw.dailyMessage.findMany({ where, include: INCLUDE, orderBy: [{ date: "desc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((m) => toPublicListDto(m, lang)), meta: pageMeta(page, limit, total) };
}
