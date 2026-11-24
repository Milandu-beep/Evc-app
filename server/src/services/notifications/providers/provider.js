// Contrat commun des fournisseurs de notifications (OneSignal, faux fournisseur de test, aucun).
// Le NotificationService ne connaît que cette interface : aucun module métier (événements, actualités,
// messages du jour, prédications) n'appelle un fournisseur, ils émettent seulement des événements de domaine.

/**
 * Erreur d'un fournisseur. retryable : vrai pour un incident passager (réseau, 429, 5xx) qui mérite une
 * nouvelle tentative ; faux pour un refus définitif (clé invalide, requête incorrecte).
 */
export class ProviderError extends Error {
  constructor(message, { retryable = false, status = null, details = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.status = status;
    this.details = details;
  }
}

/**
 * Message à envoyer (indépendant du fournisseur) :
 * {
 *   notificationId,                 // identifiant de notre notification : sert d'identifiant d'idempotence
 *   audience,                       // ALL | ADMINS | MEMBERS | VISITORS
 *   type,                           // GENERAL | EVENT | NEWS | DAILY_MESSAGE | SERMON | TEST
 *   defaultLanguage,                // langue de repli (fr)
 *   contents: { fr: { title, body, path? }, en?: { … } },
 *   data,                           // charge utile pour l'application { type, ids… }
 * }
 */
export default class NotificationProvider {
  /** Nom enregistré dans notifications.provider (« onesignal », « fake »…). */
  get name() {
    throw new Error("name non implémenté");
  }

  /** Faux tant que le fournisseur n'est pas configuré : le planificateur n'envoie alors rien. */
  get enabled() {
    return false;
  }

  /**
   * Envoie le message. Retourne { providerMessageId, recipients? } ou lève une ProviderError.
   * L'envoi doit être idempotent par notificationId (une reprise après arrêt ne double pas l'envoi).
   */
  // eslint-disable-next-line no-unused-vars
  async send(message) {
    throw new Error("send non implémenté");
  }
}
