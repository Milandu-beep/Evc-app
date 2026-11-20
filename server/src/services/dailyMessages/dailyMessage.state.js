// Règles d'état et de visibilité des messages du jour. Fonctions pures.
// Le cycle de vie est celui des actualités (voir content/lifecycle.js) ; en plus, un message est
// attaché à une DATE : publié, il n'est affiché qu'à partir de cette date (jour local de l'église).
import env from "../../config/env.js";
import { dateOnlyToUtc, localDateString } from "../../utils/timezone.js";
import { publicVisibility } from "../content/lifecycle.js";

export * from "../content/lifecycle.js";

// « AAAA-MM-JJ » du jour courant à l'église (Africa/Kinshasa par défaut).
export const todayString = (now = new Date()) => localDateString(now, env.timeZone);
export const todayDate = (now = new Date()) => dateOnlyToUtc(todayString(now));

export const dateString = (date) => date.toISOString().slice(0, 10);

/** UPCOMING (date future), CURRENT (aujourd'hui) ou PAST (passée). */
export function phaseOf(date, now = new Date()) {
  const d = dateString(date);
  const today = todayString(now);
  if (d > today) return "UPCOMING";
  return d === today ? "CURRENT" : "PAST";
}

// Affichable au public : publié (ou programmé et échu) ET date atteinte.
export const liveWhere = (now = new Date()) => ({ AND: [publicVisibility(now), { date: { lte: todayDate(now) } }] });
