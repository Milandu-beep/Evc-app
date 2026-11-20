import { DEFAULT_LANGUAGE } from "../../config/constants.js";
import { coverDto, excerptOf } from "../content/dto.js";
import { computeState } from "./news.state.js";

const translationDto = (t) => ({ slug: t.slug, title: t.title, excerpt: t.excerpt, content: t.content });

// Vue complète pour l'administration : toutes les langues et tous les champs de gestion.
export function toAdminDto(news, now = new Date()) {
  return {
    id: news.id,
    status: news.status,
    state: computeState(news, now),
    isFeatured: news.isFeatured,
    publishAt: news.publishAt,
    publishedAt: news.publishedAt,
    notifyOnPublish: news.notifyOnPublish,
    coverImage: coverDto(news.coverImage),
    translations: Object.fromEntries(news.translations.map((t) => [t.language, translationDto(t)])),
    createdById: news.createdById,
    createdAt: news.createdAt,
    updatedAt: news.updatedAt,
    deletedAt: news.deletedAt,
  };
}

function localized(news, language) {
  const byLang = Object.fromEntries(news.translations.map((t) => [t.language, t]));
  return byLang[language] ?? byLang[DEFAULT_LANGUAGE] ?? news.translations[0];
}

// Date d'affichage : publication effective, ou heure programmée tant que la tâche de fond n'a pas basculé.
const displayDate = (news) => news.publishedAt ?? news.publishAt;

// Liste publique : extrait seulement (pas le texte complet).
export function toPublicListDto(news, language) {
  const t = localized(news, language);
  return {
    id: news.id,
    slug: t.slug,
    language: t.language,
    title: t.title,
    excerpt: excerptOf(t.excerpt, t.content),
    publishedAt: displayDate(news),
    isFeatured: news.isFeatured,
    coverImage: coverDto(news.coverImage),
    alternates: Object.fromEntries(news.translations.map((x) => [x.language, x.slug])),
  };
}

// Détail public : texte complet, aucun champ interne.
export function toPublicDetailDto(news, language) {
  const t = localized(news, language);
  return { ...toPublicListDto(news, language), excerpt: excerptOf(t.excerpt, t.content), content: t.content };
}
