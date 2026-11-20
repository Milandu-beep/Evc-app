import env from "./env.js";

const MB = 1024 * 1024;

// Types de fichiers acceptés. Le type réel est détecté par le CONTENU du fichier,
// jamais par son extension ni son Content-Type (voir services/storage/file-type.js).
// resourceType : type de ressource Cloudinary. L'audio y est traité comme de la vidéo.
export const FILE_KINDS = Object.freeze({
  image: {
    mimes: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
    maxBytes: 10 * MB,
    resourceType: "IMAGE",
  },
  video: {
    mimes: { "video/mp4": "mp4", "video/webm": "webm" },
    maxBytes: 100 * MB,
    resourceType: "VIDEO",
  },
  audio: {
    mimes: { "audio/mpeg": "mp3" },
    maxBytes: 100 * MB,
    resourceType: "VIDEO",
  },
  pdf: {
    mimes: { "application/pdf": "pdf" },
    maxBytes: 10 * MB,
    resourceType: "RAW",
  },
});

// Plus grande taille tous types confondus : limite appliquée par Multer à la réception.
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(FILE_KINDS).map((k) => k.maxBytes));

// Dossiers logiques autorisés et types de fichiers acceptés dans chacun.
// Liste fermée : toute autre valeur est refusée. Arborescence : docs/STORAGE_ARCHITECTURE.md §3.
export const FOLDERS = Object.freeze({
  "branding/logos": ["image"],
  "branding/favicon": ["image"],
  "branding/pwa": ["image"],
  "events/covers": ["image"],
  "events/gallery": ["image"],
  "events/documents": ["pdf"],
  "news/covers": ["image"],
  "news/gallery": ["image"],
  "sermons/audio": ["audio"],
  "sermons/thumbnails": ["image"],
  "sermons/documents": ["pdf"],
  gallery: ["image", "video"],
  "profiles/pastors": ["image"],
  "profiles/admins": ["image"],
  "profiles/users": ["image"],
  temporary: ["image", "video", "audio", "pdf"],
});

export const isValidFolder = (folder) =>
  typeof folder === "string" && Object.prototype.hasOwnProperty.call(FOLDERS, folder);

// Fournisseur utilisé par défaut pour tous les types (voir services/storage/storage.service.js).
export const DEFAULT_PROVIDER = "CLOUDINARY";

// Nettoyage des fichiers orphelins.
export const CLEANUP = Object.freeze({
  orphanGraceHours: 24, // un fichier non rattaché n'est marqué qu'après ce délai
  retentionDays: 30, // un fichier marqué n'est supprimé définitivement qu'après ce délai
});

// Vignettes (largeur en px) servies par urlFor().
export const THUMBNAIL_WIDTH = 400;

// Dossier temporaire de réception des envois (nettoyé après chaque requête).
export const UPLOAD_TMP_DIR = new URL("../uploads/tmp/", import.meta.url);

export const storageRoot = env.storageRoot;
