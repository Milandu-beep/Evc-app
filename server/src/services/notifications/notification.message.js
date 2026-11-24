import { DEFAULT_LANGUAGE } from "../../config/constants.js";

// Message indépendant du fournisseur (voir providers/provider.js), construit depuis une notification et ses traductions.
export function buildMessage(n) {
  const contents = {};
  for (const t of n.translations) contents[t.language] = { title: t.title, body: t.message, ...(t.url && { path: t.url }) };
  const defaultLanguage = contents[DEFAULT_LANGUAGE] ? DEFAULT_LANGUAGE : Object.keys(contents)[0];

  return {
    notificationId: n.id,
    audience: n.audience,
    type: n.type,
    defaultLanguage,
    contents,
    // Lu par l'application au toucher de la notification
    data: {
      type: n.type,
      notificationId: n.id,
      ...(n.eventId && { eventId: n.eventId }),
      ...(n.newsId && { newsId: n.newsId }),
      ...(n.dailyMessageId && { dailyMessageId: n.dailyMessageId }),
      ...(n.sermonId && { sermonId: n.sermonId }),
    },
  };
}
