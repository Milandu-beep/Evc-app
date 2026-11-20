// Transforme un titre en identifiant d'URL : « Soirée de Louange & Adoration ! » -> « soiree-de-louange-adoration ».
export function slugify(text, { maxLength = 80, fallback = "evenement" } = {}) {
  const slug = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
