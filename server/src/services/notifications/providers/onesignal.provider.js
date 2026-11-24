import NotificationProvider, { ProviderError } from "./provider.js";

const TIMEOUT_MS = 10_000;

/**
 * Fournisseur OneSignal (API REST « Create message »). PRÉPARÉ MAIS DÉSACTIVÉ tant que ONESIGNAL_APP_ID et
 * ONESIGNAL_API_KEY ne sont pas fournis : `enabled` est alors faux et le planificateur n'envoie rien.
 * Aucun appel réseau n'a lieu à la construction ; fetchImpl est injectable (tests sans réseau).
 */
export default class OneSignalProvider extends NotificationProvider {
  constructor({ appId, apiKey, baseUrl = "https://api.onesignal.com", segments, publicSiteUrl = "", fetchImpl = globalThis.fetch } = {}) {
    super();
    this.appId = appId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.segments = segments;
    this.publicSiteUrl = publicSiteUrl;
    this.fetchImpl = fetchImpl;
  }

  get name() {
    return "onesignal";
  }

  get enabled() {
    return Boolean(this.appId && this.apiKey);
  }

  /** Corps de la requête (sans appel réseau) : exposé pour pouvoir le vérifier dans les tests. */
  buildPayload(message) {
    const { contents, defaultLanguage = "fr" } = message;
    const headings = {};
    const bodies = {};
    for (const [lang, c] of Object.entries(contents)) {
      headings[lang] = c.title;
      bodies[lang] = c.body;
    }
    // OneSignal exige une version « en » : à défaut, on reprend la langue par défaut
    if (!bodies.en) {
      headings.en = contents[defaultLanguage].title;
      bodies.en = contents[defaultLanguage].body;
    }

    const paths = Object.fromEntries(Object.entries(contents).filter(([, c]) => c.path).map(([lang, c]) => [lang, c.path]));
    const defaultPath = contents[defaultLanguage]?.path;
    return {
      app_id: this.appId,
      target_channel: "push",
      included_segments: [this.segments[message.audience] ?? this.segments.ALL],
      headings,
      contents: bodies,
      // data : lu par l'application au toucher ; les chemins sont propres à chaque langue
      data: { ...message.data, paths },
      ...(defaultPath && this.publicSiteUrl && { url: `${this.publicSiteUrl}${defaultPath}` }),
      idempotency_key: message.notificationId, // une reprise ne double pas l'envoi
    };
  }

  async send(message) {
    if (!this.enabled) throw new ProviderError("OneSignal n'est pas configuré", { retryable: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/notifications?c=push`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Key ${this.apiKey}` },
        body: JSON.stringify(this.buildPayload(message)),
        signal: controller.signal,
      });
    } catch (err) {
      // Réseau coupé, délai dépassé : incident passager
      throw new ProviderError(`OneSignal injoignable : ${err.name === "AbortError" ? "délai dépassé" : err.message}`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      /* corps vide ou non JSON */
    }
    const errors = body?.errors;
    const detail = Array.isArray(errors) ? errors.join(" ; ") : errors ? JSON.stringify(errors) : null;

    if (!response.ok) {
      // 429 et 5xx : réessayer. Autres 4xx (clé invalide, requête refusée) : définitif.
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`OneSignal ${response.status}${detail ? ` : ${detail}` : ""}`, { retryable, status: response.status, details: body });
    }
    // 200 sans identifiant et « aucun abonné » : l'envoi est valide, personne à joindre
    if (!body?.id) {
      if (detail && /not subscribed|no subscribed/i.test(detail)) return { providerMessageId: null, recipients: 0 };
      throw new ProviderError(`OneSignal a répondu sans identifiant${detail ? ` : ${detail}` : ""}`, { retryable: false, status: response.status, details: body });
    }
    return { providerMessageId: body.id, recipients: typeof body.recipients === "number" ? body.recipients : undefined };
  }
}
