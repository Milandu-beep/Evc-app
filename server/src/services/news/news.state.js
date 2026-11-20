// Règles d'état des actualités. Même logique que les événements (voir events/event.state.js),
// sans annulation ni état « terminé ». Fonctions pures, testables isolément.

export const NEWS_STATES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"];

// Une actualité programmée dont l'heure est venue est publiée « de fait », même si la tâche de fond
// ne l'a pas encore basculée : la lecture ne dépend jamais du retard de cette tâche.
export const isScheduledDue = (news, now = new Date()) =>
  news.status === "SCHEDULED" && news.publishAt != null && news.publishAt <= now;

export const computeState = (news, now = new Date()) => (isScheduledDue(news, now) ? "PUBLISHED" : news.status);

// Visible publiquement : publiée, ou programmée et échue.
export const publicVisibility = (now) => ({
  OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishAt: { lte: now } }],
});

/** Filtre Prisma pour un état donné (liste d'administration). */
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
