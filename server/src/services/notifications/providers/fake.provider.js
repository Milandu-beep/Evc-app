import NotificationProvider, { ProviderError } from "./provider.js";

/**
 * Faux fournisseur : tout reste en mémoire, aucun appel réseau. Sert aux tests automatisés et au développement.
 * Reproduit le comportement utile d'un vrai fournisseur : identifiants, idempotence, échecs passagers ou définitifs.
 */
export default class FakeProvider extends NotificationProvider {
  constructor({ recipients = 42 } = {}) {
    super();
    this.recipients = recipients;
    this.sent = []; // messages « envoyés » (copie), avec leur identifiant
    this.attempts = []; // tous les appels, réussis ou non
    this.delayMs = 0;
    this._failures = [];
    this._seq = 0;
    this._byNotification = new Map();
  }

  get name() {
    return "fake";
  }

  get enabled() {
    return true;
  }

  /** Les `count` prochains envois échouent. retryable : incident passager (true) ou refus définitif (false). */
  failNext(count = 1, { retryable = true, message = "Échec simulé" } = {}) {
    for (let i = 0; i < count; i += 1) this._failures.push({ retryable, message });
  }

  async send(message) {
    this.attempts.push({ notificationId: message.notificationId, at: new Date() });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));

    const failure = this._failures.shift();
    if (failure) throw new ProviderError(failure.message, { retryable: failure.retryable, status: failure.retryable ? 503 : 400 });

    // Idempotence : un second envoi du même identifiant ne produit pas de second message
    const prior = this._byNotification.get(message.notificationId);
    if (prior) return { ...prior, deduplicated: true };

    const result = { providerMessageId: `fake-${(this._seq += 1)}`, recipients: this.recipients };
    this.sent.push({ ...structuredClone(message), providerMessageId: result.providerMessageId });
    this._byNotification.set(message.notificationId, result);
    return result;
  }

  reset() {
    this.sent = [];
    this.attempts = [];
    this._failures = [];
    this._byNotification.clear();
    this._seq = 0;
    this.delayMs = 0;
  }
}
