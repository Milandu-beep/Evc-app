// Cycle de vie simple : brouillon -> publié -> archivé (pas de programmation).
// Utilisé par les albums de galerie, les personnes et les séries de prédications.
export const PUBLISH_STATES = ["DRAFT", "PUBLISHED", "ARCHIVED"];
export const PUBLISH_TRANSITIONS = Object.freeze({
  publish: { from: ["DRAFT"], to: "PUBLISHED" },
  unpublish: { from: ["PUBLISHED"], to: "DRAFT" },
  archive: { from: ["DRAFT", "PUBLISHED"], to: "ARCHIVED" },
  unarchive: { from: ["ARCHIVED"], to: "DRAFT" },
});
export const canPublishTransition = (action, status) => PUBLISH_TRANSITIONS[action]?.from.includes(status) ?? false;
