// Constantes du tableau de bord (voir docs/DASHBOARD.md). Sans dépendance : utilisables par les règles pures.

export const DASHBOARD = Object.freeze({
  AGENDA_DEFAULT_DAYS: 7,
  AGENDA_MAX_DAYS: 31,
  AGENDA_LIMIT: 20, // événements et notifications affichés dans l'agenda
  PUBLICATIONS_LIMIT: 50, // publications programmées affichées dans l'agenda
  RECENT_DAYS: 30, // période des compteurs « publiés récemment » / « envoyées récemment »
  TOP_SERMONS: 5,
  LATE_MINUTES: 5, // retard au-delà duquel une programmation ou une notification est signalée
  DAILY_MESSAGE_LOOKAHEAD_DAYS: 7, // jours vérifiés pour l'alerte « messages du jour manquants »
  ACTIVITY_DEFAULT_LIMIT: 20,
});

// Entités du journal d'audit (noms des tables, tels qu'écrits par les modules).
export const AUDIT_ENTITIES = Object.freeze([
  "admins",
  "events",
  "news",
  "daily_messages",
  "gallery_albums",
  "gallery_items",
  "people",
  "sermons",
  "sermon_series",
  "sermon_documents",
  "notifications",
  "storage_files",
]);

// Valeurs de l'enum AuditAction (schéma Prisma).
export const AUDIT_ACTIONS = Object.freeze(["CREATE", "UPDATE", "DELETE", "RESTORE", "LOGIN", "UPLOAD_FILE", "DELETE_FILE", "STATUS_CHANGE"]);

// Entité réservée au Super Admin (gestion des administrateurs, charte §4).
export const SUPER_ADMIN_ONLY_ENTITY = "admins";
