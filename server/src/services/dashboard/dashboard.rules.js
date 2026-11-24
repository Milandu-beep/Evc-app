// Règles du tableau de bord : fenêtre de l'agenda, couverture des messages du jour, alertes, agrégation des compteurs.
// Fonctions pures (sans base de données ni variables d'environnement) : testables isolément.
import { endOfLocalDateString, localDateString } from "../../utils/timezone.js";

export const SEVERITIES = ["critical", "warning", "info"];

// « AAAA-MM-JJ » + n jours (calcul sur la date seule : indépendant du fuseau et de l'heure d'été).
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fenêtre de `days` jours de l'église, d'aujourd'hui au dernier jour inclus.
 * { days, from, to, dates[], end } — end : dernière milliseconde du dernier jour (instant UTC).
 */
export function agendaWindow(now, days, timeZone) {
  const from = localDateString(now, timeZone);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const to = dates[dates.length - 1];
  return { days, from, to, dates, end: endOfLocalDateString(to, timeZone) };
}

// Un message du jour « couvre » sa date s'il est publié ou programmé (état affiché).
export const COVERING_STATES = ["PUBLISHED", "SCHEDULED"];

/**
 * Un élément par date : { date, covered, message }. `messages` : [{ date: "AAAA-MM-JJ", state, ...reste }]
 * (au plus un message actif par date : contrainte d'unicité en base).
 */
export function dailyCoverage(dates, messages) {
  const byDate = new Map(messages.map((m) => [m.date, m]));
  return dates.map((date) => {
    const message = byDate.get(date) ?? null;
    return { date, covered: Boolean(message && COVERING_STATES.includes(message.state)), message };
  });
}

export const missingDates = (coverage) => coverage.filter((c) => !c.covered).map((c) => c.date);

/** { total, byState } à partir de comptes rangés dans l'ordre de `states` (les états forment une partition). */
export function partition(states, counts) {
  const byState = Object.fromEntries(states.map((s, i) => [s, counts[i] ?? 0]));
  return { total: counts.reduce((a, b) => a + (b ?? 0), 0), byState };
}

/**
 * Alertes à traiter, seulement celles qui existent, triées par gravité.
 * input : { today, missingDailyDates[], failedNotifications, lateNotifications, scheduledNotifications,
 *           providerEnabled, schedulerLate: { events, news, dailyMessages, sermons }, stuckUploads }
 */
export function buildAlerts(input) {
  const alerts = [];
  const add = (code, severity, count, data) => {
    if (count > 0) alerts.push({ code, severity, count, ...(data && { data }) });
  };

  const missing = input.missingDailyDates ?? [];
  add("DAILY_MESSAGES_MISSING", missing.includes(input.today) ? "critical" : "warning", missing.length, { dates: missing });
  add("NOTIFICATIONS_FAILED", "warning", input.failedNotifications ?? 0);
  if (input.providerEnabled) add("NOTIFICATIONS_LATE", "warning", input.lateNotifications ?? 0);
  else add("NOTIFICATIONS_PROVIDER_DISABLED", "info", input.scheduledNotifications ?? 0);

  const late = { events: 0, news: 0, dailyMessages: 0, sermons: 0, ...input.schedulerLate };
  add("SCHEDULER_LATE", "warning", late.events + late.news + late.dailyMessages + late.sermons, late);
  add("STORAGE_UPLOADS_STUCK", "info", input.stuckUploads ?? 0);

  // Tri stable : par gravité, puis dans l'ordre ci-dessus.
  return alerts.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}
