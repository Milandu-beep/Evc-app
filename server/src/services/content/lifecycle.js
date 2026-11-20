// Cycle de vie commun des contenus « simples » : brouillon -> programmé -> publié -> archivé.
// Utilisé par les actualités et les messages du jour. Les événements ont leur propre règle
// (annulation, état « terminé » déduit des dates : voir events/event.state.js).
// Fonctions pures (sans base de données) : testables isolément.

export const LIFECYCLE_STATES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"];

// Un contenu programmé dont l'heure est venue est publié « de fait », même si la tâche de fond
// ne l'a pas encore basculé : la lecture ne dépend jamais du retard de cette tâche.
export const isScheduledDue = (item, now = new Date()) =>
  item.status === "SCHEDULED" && item.publishAt != null && item.publishAt <= now;

export const computeState = (item, now = new Date()) => (isScheduledDue(item, now) ? "PUBLISHED" : item.status);

// Publié, ou programmé et échu.
export const publicVisibility = (now) => ({
  OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishAt: { lte: now } }],
});

/** Filtre Prisma pour un état donné (listes d'administration). */
export function stateWhere(state, now = new Date()) {
  switch (state) {
    case "DRAFT":
      return { status: "DRAFT" };
    case "SCHEDULED":
      return { status: "SCHEDULED", publishAt: { gt: now } };
    case "PUBLISHED":
      return publicVisibility(now);
    case "ARCHIVED":
      return { status: "ARCHIVED" };
    default:
      return {};
  }
}

export const TRANSITIONS = Object.freeze({
  publish: { from: ["DRAFT", "SCHEDULED"], to: "PUBLISHED" },
  schedule: { from: ["DRAFT", "SCHEDULED"], to: "SCHEDULED" },
  unpublish: { from: ["PUBLISHED", "SCHEDULED"], to: "DRAFT" },
  archive: { from: ["DRAFT", "SCHEDULED", "PUBLISHED"], to: "ARCHIVED" },
  unarchive: { from: ["ARCHIVED"], to: "DRAFT" },
});

export const canTransition = (action, status) => TRANSITIONS[action]?.from.includes(status) ?? false;
