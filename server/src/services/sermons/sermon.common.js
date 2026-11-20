// Règles communes des prédications : rôles d'intervenant, lien YouTube, contrôle des fichiers rattachés.
import prisma from "../../config/prisma.js";
import { invalid } from "../content/common.js";

export const SPEAKER_ROLES = ["PREACHER", "GUEST_PREACHER", "TRANSLATOR", "WORSHIP_LEADER", "MODERATOR", "PRAYER", "OTHER"];
export const MAX_SPEAKERS = 10;
export const MAX_VERSES = 10;
export const MAX_DOCUMENTS = 20;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Identifiant YouTube (11 caractères) extrait d'un lien : youtu.be/ID, youtube.com/watch?v=ID,
 * /embed/ID, /shorts/ID, /live/ID, /v/ID (y compris youtube-nocookie.com et m.youtube.com).
 * Retourne null si le lien n'est pas reconnu.
 */
export function parseYoutubeId(input) {
  const text = String(input ?? "").trim();
  if (YOUTUBE_ID.test(text)) return text; // identifiant seul
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const [, kind, value] = url.pathname.split("/");
      if (["embed", "shorts", "live", "v"].includes(kind)) id = value;
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export const youtubeDto = (id) =>
  id && {
    id,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  };

// Références de versets : espaces nettoyés, vides et doublons retirés.
export const normalizeVerses = (list) => [...new Set((list ?? []).map((v) => String(v).replace(/\s+/g, " ").trim()).filter(Boolean))];

// --- Fichiers rattachés : prêts (READY), du bon type, non supprimés ---
async function assertFile(id, field, accepts, label) {
  if (!id) return null;
  const file = await prisma.storageFile.findUnique({ where: { id } });
  if (!file || file.status !== "READY" || !accepts(file)) throw invalid(field, `Fichier introuvable, non prêt ou n'étant pas ${label}`);
  return file;
}
export const assertAudioFile = (id) => assertFile(id, "audioFileId", (f) => f.mimeType?.startsWith("audio/"), "un fichier audio (MP3)");
export const assertVideoFile = (id) => assertFile(id, "videoFileId", (f) => f.resourceType === "VIDEO" && f.mimeType?.startsWith("video/"), "une vidéo");
export const assertPdfFile = (id, field = "storageFileId") => assertFile(id, field, (f) => f.resourceType === "RAW" && f.mimeType === "application/pdf", "un document PDF");

// Nom de fichier sans extension : titre de repli d'un document sans titre.
export const baseName = (filename) => String(filename ?? "").replace(/\.[^.]{1,5}$/, "").trim() || "Document";
