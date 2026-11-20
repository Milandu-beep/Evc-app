// Temps de lecture estimé, en minutes (au moins 1), à ~200 mots par minute (lecture à voix basse en français).
const WORDS_PER_MINUTE = 200;

export const countWords = (text) => (String(text ?? "").trim().match(/\S+/g) ?? []).length;

// Calculé sur les textes lus par l'utilisateur : contenu et texte du verset.
export function estimateReadingTime(...texts) {
  const words = texts.reduce((sum, t) => sum + countWords(t), 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
