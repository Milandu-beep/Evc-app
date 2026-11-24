// Tableau de bord de l'administration (voir docs/DASHBOARD.md). Lecture seule : aucune écriture, pas même dans l'audit.
// Les compteurs par état réutilisent les filtres des modules (mêmes résultats que les listes d'administration).
// Le client `prisma` exclut les lignes supprimées logiquement.
import prisma from "../../config/prisma.js";
import env from "../../config/env.js";
import { CLEANUP } from "../../config/storage.js";
import { DASHBOARD, SUPER_ADMIN_ONLY_ENTITY } from "../../config/dashboard.js";
import { HTTP_STATUS, ROLES } from "../../config/constants.js";
import AppError from "../../utils/AppError.js";
import { pageMeta } from "../content/common.js";
import { dateOnlyToUtc } from "../../utils/timezone.js";
import { pickTranslation } from "../content/dto.js";
import { LIFECYCLE_STATES, computeState as lifecycleState, stateWhere as lifecycleWhere } from "../content/lifecycle.js";
import { PUBLISH_STATES } from "../content/simpleLifecycle.js";
import { EVENT_STATES, computeState as eventState, notEndedWhere, stateWhere as eventWhere } from "../events/event.state.js";
import { providerStatus } from "../notifications/notification.service.js";
import { agendaWindow, buildAlerts, dailyCoverage, missingDates, partition } from "./dashboard.rules.js";

const NOTIFICATION_STATUSES = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"];
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Contenus à publication programmée : délégué Prisma et nom du module dans les réponses.
const SCHEDULABLE = [
  { module: "events", delegate: "event" },
  { module: "news", delegate: "news" },
  { module: "dailyMessages", delegate: "dailyMessage" },
  { module: "sermons", delegate: "sermon" },
];

const titleOf = (row, language) => pickTranslation(row.translations, language)?.title ?? null;
const countStates = (delegate, states, whereOf) => Promise.all(states.map((s) => prisma[delegate].count({ where: whereOf(s) })));

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------
async function lifecycleSummary(delegate, now, since) {
  const [counts, publishedRecently] = await Promise.all([
    countStates(delegate, LIFECYCLE_STATES, (s) => lifecycleWhere(s, now)),
    prisma[delegate].count({ where: { publishedAt: { gte: since } } }),
  ]);
  return { ...partition(LIFECYCLE_STATES, counts), publishedRecently };
}

const simpleSummary = async (delegate) => partition(PUBLISH_STATES, await countStates(delegate, PUBLISH_STATES, (status) => ({ status })));

async function eventsSummary(now, since) {
  const [counts, publishedRecently] = await Promise.all([
    countStates("event", EVENT_STATES, (s) => eventWhere(s, now)),
    prisma.event.count({ where: { publishedAt: { gte: since } } }),
  ]);
  return { ...partition(EVENT_STATES, counts), publishedRecently };
}

async function sermonsSummary(now, since, language) {
  const [base, sums, top] = await Promise.all([
    lifecycleSummary("sermon", now, since),
    prisma.sermon.aggregate({ _sum: { viewCount: true, playCount: true, downloadCount: true } }),
    prisma.sermon.findMany({
      where: lifecycleWhere("PUBLISHED", now),
      include: { translations: true },
      orderBy: [{ viewCount: "desc" }, { date: "desc" }, { id: "asc" }],
      take: DASHBOARD.TOP_SERMONS,
    }),
  ]);
  return {
    ...base,
    stats: { views: sums._sum.viewCount ?? 0, plays: sums._sum.playCount ?? 0, downloads: sums._sum.downloadCount ?? 0 },
    top: top.map((s) => ({
      id: s.id,
      title: titleOf(s, language),
      date: s.date.toISOString().slice(0, 10),
      views: s.viewCount,
      plays: s.playCount,
      downloads: s.downloadCount,
    })),
  };
}

async function gallerySummary() {
  // Les médias d'un album supprimé ne comptent pas (comme dans la galerie publique et l'administration).
  const itemWhere = (extra = {}) => ({ where: { album: { deletedAt: null }, ...extra } });
  const [albums, total, photos, videos] = await Promise.all([
    simpleSummary("galleryAlbum"),
    prisma.galleryItem.count(itemWhere()),
    prisma.galleryItem.count(itemWhere({ type: "PHOTO" })),
    prisma.galleryItem.count(itemWhere({ type: "VIDEO" })),
  ]);
  return { albums, items: { total, photos, videos } };
}

async function notificationsSummary(since) {
  const [counts, sentRecently] = await Promise.all([
    countStates("notification", NOTIFICATION_STATUSES, (status) => ({ status })),
    prisma.notification.count({ where: { status: "SENT", sentAt: { gte: since } } }),
  ]);
  const { total, byState } = partition(NOTIFICATION_STATUSES, counts);
  return { total, byStatus: byState, sentRecently, provider: providerStatus() };
}

async function storageSummary() {
  const groups = await prisma.storageFile.groupBy({
    by: ["resourceType"],
    where: { status: "READY" },
    _count: { _all: true },
    _sum: { bytes: true },
  });
  const byResourceType = { IMAGE: { files: 0, bytes: 0 }, VIDEO: { files: 0, bytes: 0 }, RAW: { files: 0, bytes: 0 } };
  for (const g of groups) byResourceType[g.resourceType] = { files: g._count._all, bytes: Number(g._sum.bytes ?? 0) };
  const all = Object.values(byResourceType);
  return { files: all.reduce((a, x) => a + x.files, 0), bytes: all.reduce((a, x) => a + x.bytes, 0), byResourceType };
}

async function adminsSummary() {
  const [total, active] = await Promise.all([prisma.admin.count(), prisma.admin.count({ where: { isActive: true } })]);
  return { total, active };
}

async function summary({ language, isSuperAdmin }, now = new Date()) {
  const since = new Date(now.getTime() - DASHBOARD.RECENT_DAYS * DAY);
  const [events, news, dailyMessages, sermons, sermonSeries, gallery, people, notifications, storage, admins] = await Promise.all([
    eventsSummary(now, since),
    lifecycleSummary("news", now, since),
    lifecycleSummary("dailyMessage", now, since),
    sermonsSummary(now, since, language),
    simpleSummary("sermonSeries"),
    gallerySummary(),
    simpleSummary("person"),
    notificationsSummary(since),
    storageSummary(),
    isSuperAdmin ? adminsSummary() : null,
  ]);
  return {
    recentDays: DASHBOARD.RECENT_DAYS,
    events,
    news,
    dailyMessages,
    sermons,
    sermonSeries,
    gallery,
    people,
    notifications,
    storage,
    ...(isSuperAdmin && { admins }),
  };
}

// ---------------------------------------------------------------------------
// Messages du jour d'une liste de dates : { date, state, id, title }
// ---------------------------------------------------------------------------
async function dailyMessagesOn(dates, language, now) {
  const rows = await prisma.dailyMessage.findMany({
    where: { date: { gte: dateOnlyToUtc(dates[0]), lte: dateOnlyToUtc(dates[dates.length - 1]) } },
    include: { translations: true },
  });
  return rows.map((m) => ({
    date: m.date.toISOString().slice(0, 10),
    id: m.id,
    state: lifecycleState(m, now),
    title: titleOf(m, language),
  }));
}

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------
async function alertsFrom({ now, today, lookaheadCoverage }) {
  const lateBefore = new Date(now.getTime() - DASHBOARD.LATE_MINUTES * MINUTE);
  const provider = providerStatus();
  const [failedNotifications, scheduledNotifications, lateNotifications, stuckUploads, ...lateCounts] = await Promise.all([
    prisma.notification.count({ where: { status: "FAILED" } }),
    prisma.notification.count({ where: { status: "SCHEDULED" } }),
    prisma.notification.count({ where: { status: "SCHEDULED", scheduledAt: { lt: lateBefore } } }),
    prisma.storageFile.count({ where: { status: "UPLOADING", createdAt: { lt: new Date(now.getTime() - CLEANUP.stuckUploadMinutes * MINUTE) } } }),
    ...SCHEDULABLE.map(({ delegate }) => prisma[delegate].count({ where: { status: "SCHEDULED", publishAt: { lt: lateBefore } } })),
  ]);
  return buildAlerts({
    today,
    missingDailyDates: missingDates(lookaheadCoverage),
    failedNotifications,
    scheduledNotifications,
    lateNotifications,
    providerEnabled: provider.enabled,
    schedulerLate: Object.fromEntries(SCHEDULABLE.map(({ module }, i) => [module, lateCounts[i]])),
    stuckUploads,
  });
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------
async function agendaFrom({ window, language, now, coverage }) {
  const [events, publicationLists, notifications] = await Promise.all([
    prisma.event.findMany({
      where: { AND: [{ status: { in: ["PUBLISHED", "SCHEDULED"] } }, notEndedWhere(now), { startsAt: { lte: window.end } }] },
      include: { translations: true },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: DASHBOARD.AGENDA_LIMIT,
    }),
    Promise.all(
      SCHEDULABLE.map(async ({ module, delegate }) =>
        (
          await prisma[delegate].findMany({
            where: { status: "SCHEDULED", publishAt: { gt: now, lte: window.end } },
            include: { translations: true },
            orderBy: [{ publishAt: "asc" }, { id: "asc" }],
            take: DASHBOARD.PUBLICATIONS_LIMIT,
          })
        ).map((row) => ({ module, id: row.id, title: titleOf(row, language), publishAt: row.publishAt }))
      )
    ),
    prisma.notification.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: window.end } },
      include: { translations: true },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: DASHBOARD.AGENDA_LIMIT,
    }),
  ]);

  const publications = publicationLists
    .flat()
    .sort((a, b) => a.publishAt - b.publishAt || a.id.localeCompare(b.id))
    .slice(0, DASHBOARD.PUBLICATIONS_LIMIT);

  return {
    days: window.days,
    from: window.from,
    to: window.to,
    events: events.map((e) => {
      const t = pickTranslation(e.translations, language);
      return { id: e.id, title: t?.title ?? null, location: t?.location ?? null, state: eventState(e, now), startsAt: e.startsAt, endsAt: e.endsAt, isFeatured: e.isFeatured };
    }),
    publications,
    notifications: notifications.map((n) => ({ id: n.id, type: n.type, audience: n.audience, title: titleOf(n, language), scheduledAt: n.scheduledAt })),
    dailyMessages: coverage.map(({ date, covered, message }) => ({
      date,
      covered,
      message: message && { id: message.id, state: message.state, title: message.title },
    })),
  };
}

// ---------------------------------------------------------------------------
// Vue d'ensemble : indicateurs, alertes, agenda
// ---------------------------------------------------------------------------
export async function overview({ language, days = DASHBOARD.AGENDA_DEFAULT_DAYS, role }, now = new Date()) {
  const timeZone = env.timeZone;
  const window = agendaWindow(now, days, timeZone);
  const lookahead = agendaWindow(now, DASHBOARD.DAILY_MESSAGE_LOOKAHEAD_DAYS, timeZone);
  // Une seule lecture des messages du jour couvre l'agenda et l'alerte (les deux fenêtres commencent aujourd'hui).
  const longest = window.dates.length >= lookahead.dates.length ? window.dates : lookahead.dates;
  const messages = await dailyMessagesOn(longest, language, now);

  const [summaryData, alerts, agenda] = await Promise.all([
    summary({ language, isSuperAdmin: role === ROLES.SUPER_ADMIN }, now),
    alertsFrom({ now, today: window.from, lookaheadCoverage: dailyCoverage(lookahead.dates, messages) }),
    agendaFrom({ window, language, now, coverage: dailyCoverage(window.dates, messages) }),
  ]);

  return { generatedAt: now, timeZone, today: window.from, language, summary: summaryData, alerts, agenda };
}

// ---------------------------------------------------------------------------
// Activité récente : journal d'audit, sans adresse IP ni navigateur
// ---------------------------------------------------------------------------
const toActivityDto = (log) => ({
  id: log.id,
  action: log.action,
  entity: log.entity,
  entityId: log.entityId,
  admin: log.admin ? { id: log.admin.id, firstName: log.admin.firstName, lastName: log.admin.lastName } : null, // null = action automatique
  changes: log.changes ?? null,
  createdAt: log.createdAt,
});

export async function activity({ page = 1, limit = DASHBOARD.ACTIVITY_DEFAULT_LIMIT, entity, action, adminId, from, to, role }) {
  const isSuperAdmin = role === ROLES.SUPER_ADMIN;
  // Gestion des administrateurs réservée au Super Admin (charte §4) : un Admin ne voit pas ces lignes.
  if (entity === SUPER_ADMIN_ONLY_ENTITY && !isSuperAdmin) throw new AppError("Accès refusé", HTTP_STATUS.FORBIDDEN);

  const where = {
    ...(entity ? { entity } : !isSuperAdmin && { entity: { not: SUPER_ADMIN_ONLY_ENTITY } }),
    ...(action && { action }),
    ...(adminId && { adminId }),
    ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { admin: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { items: rows.map(toActivityDto), meta: pageMeta(page, limit, total) };
}
