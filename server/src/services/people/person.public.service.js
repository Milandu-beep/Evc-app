import { prismaRaw } from "../../config/prisma.js";
import { HTTP_STATUS } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { pageMeta } from "../content/common.js";
import { publicVisibility } from "../content/lifecycle.js";
import { PERSON_INCLUDE, toPublicPersonDto } from "./person.dto.js";

// Fiches publiques : publiées et non supprimées, dans l'ordre d'affichage choisi (puis par nom).
const publicWhere = { deletedAt: null, status: "PUBLISHED" };
const ORDER = [{ sortOrder: "asc" }, { lastName: "asc" }, { firstName: "asc" }, { id: "asc" }];

export async function list({ lang, q, category, page, limit }) {
  const and = [];
  if (category) and.push({ categories: { has: category } });
  if (q) {
    and.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { translations: { some: { OR: ["title", "bio"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) } } },
      ],
    });
  }
  const where = { ...publicWhere, ...(and.length && { AND: and }) };
  const [total, rows] = await Promise.all([
    prismaRaw.person.count({ where }),
    prismaRaw.person.findMany({ where, include: PERSON_INCLUDE, orderBy: ORDER, skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: rows.map((p) => toPublicPersonDto(p, lang)), meta: pageMeta(page, limit, total) };
}

// Fiche complète, avec le nombre de prédications publiées de la personne.
export async function getBySlug(slug, lang, now = new Date()) {
  const person = await prismaRaw.person.findFirst({ where: { ...publicWhere, slug }, include: PERSON_INCLUDE });
  if (!person) throw new AppError("Fiche introuvable", HTTP_STATUS.NOT_FOUND);
  const sermonCount = await prismaRaw.sermon.count({
    where: { deletedAt: null, AND: [publicVisibility(now)], speakers: { some: { personId: person.id } } },
  });
  return { ...toPublicPersonDto(person, lang, { full: true }), sermonCount };
}
