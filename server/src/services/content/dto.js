import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { urlFor } from "../storage/storage.service.js";

// Traduction dans la langue demandée, sinon en français, sinon la première disponible (null si aucune).
export function pickTranslation(translations = [], language) {
  const byLang = Object.fromEntries(translations.map((t) => [t.language, t]));
  return byLang[language] ?? byLang[DEFAULT_LANGUAGE] ?? translations[0] ?? null;
}

// Image de couverture : URL calculées (jamais les URL brutes du fournisseur).
export function coverDto(file) {
  if (!file || file.status !== "READY") return null;
  return {
    id: file.id,
    url: urlFor(file),
    thumbnailUrl: urlFor(file, { thumbnail: true }),
    width: file.width,
    height: file.height,
  };
}

// Extrait d'un texte : tel quel s'il est fourni, sinon début du contenu coupé à un mot.
export function excerptOf(excerpt, content, max = 200) {
  if (excerpt) return excerpt;
  const text = String(content ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
}
