// Règles d'état des événements : calcul de l'état affiché, filtres de lecture, transitions.
// Fonctions pures (sans base de données) : testables isolément.
import env from "../../config/env.js";
import { endOfLocalDay, startOfLocalDay } from "../../utils/timezone.js";


export const EVENT_STATES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ENDED", "CANCELLED", "ARCHIVED"];

// Sans date de fin, un événement se termine à 23 h 59 (heure de l'église) du jour de son début.
export const endOf = (event) => event.endsAt ?? endOfLocalDay(event.startsAt, env.timeZone);

export const hasEnded = (event, now = new Date()) => endOf(event) < now;

// Un événement programmé dont l'heure est venue est publié « de fait », même si la tâche
// de fond ne l'a pas encore basculé : la lecture ne dépend jamais du retard de cette tâche.
export const isScheduledDue = (event, now = new Date()) =>
  event.status === "SCHEDULED" && event.publishAt != null && event.publishAt <= now;

/**
 * État affiché : DRAFT, SCHEDULED, PUBLISHED, ENDED, CANCELLED ou ARCHIVED.
 * ENDED = publié et terminé (déduit des dates, jamais stocké). Un événement annulé reste ANNULÉ.
 */
export function computeState(event, now = new Date()) {
  if (isScheduledDue(event, now)) return hasEnded(event, now) ? "ENDED" : "PUBLISHED";
  if (event.status === "PUBLISHED") return hasEnded(event, now) ? "ENDED" : "PUBLISHED";
  return event.status; // DRAFT, SCHEDULED, CANCELLED, ARCHIVED
}

// ---------------------------------------------------------------------------
// Filtres Prisma équivalents (même logique que computeState, exprimée en base)
// ---------------------------------------------------------------------------
// Sans fin renseignée : terminé quand le jour local de début est passé, c'est-à-dire startsAt avant
// le début du jour local courant. (Équivalent en base de endOfLocalDay(startsAt) < now.)
const endedWhere = (now) => ({
  OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: startOfLocalDay(now, env.timeZone) } }],
});
const notEndedWhere = (now) => ({
  OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: startOfLocalDay(now, env.timeZone) } }],
});
// Visible publiquement : publié, programmé et échu, ou annulé après avoir été publié.
const publiclyVisibleWhere = (now) => ({
  OR: [
    { status: "PUBLISHED" },
    { status: "SCHEDULED", publishAt: { lte: now } },
    { status: "CANCELLED", publishedAt: { not: null } },
  ],
});

export const publicVisibility = publiclyVisibleWhere;
export { endedWhere, notEndedWhere };

/** Filtre Prisma pour un état donné (utilisé par la liste d'administration). */
export function stateWhere(state, now = new Date()) {
  switch (state) {
    case "DRAFT":
      return { status: "DRAFT" };
    case "SCHEDULED":
      return { status: "SCHEDULED", publishAt: { gt: now } };
    case "PUBLISHED":
      return {
        AND: [{ OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishAt: { lte: now } }] }, notEndedWhere(now)],
      };
    case "ENDED":
      return {
        AND: [{ OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishAt: { lte: now } }] }, endedWhere(now)],
      };
    case "CANCELLED":
      return { status: "CANCELLED" };
    case "ARCHIVED":
      return { status: "ARCHIVED" };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Transitions autorisées (statuts stockés)
// ---------------------------------------------------------------------------
export const TRANSITIONS = Object.freeze({
  publish: { from: ["DRAFT", "SCHEDULED", "CANCELLED"], to: "PUBLISHED" },
  schedule: { from: ["DRAFT", "SCHEDULED"], to: "SCHEDULED" },
  unpublish: { from: ["PUBLISHED", "SCHEDULED", "CANCELLED"], to: "DRAFT" },
  cancel: { from: ["PUBLISHED"], to: "CANCELLED" },
  archive: { from: ["DRAFT", "SCHEDULED", "PUBLISHED", "CANCELLED"], to: "ARCHIVED" },
  unarchive: { from: ["ARCHIVED"], to: "DRAFT" },
});

export const canTransition = (action, status) => TRANSITIONS[action]?.from.includes(status) ?? false;
