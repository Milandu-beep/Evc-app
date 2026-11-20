// Ensemble de clés avec durée de vie : sert à ne compter qu'une fois une action répétée (vue, écoute…)
// par visiteur sur une période. En mémoire : valable pour une seule instance du serveur (limite documentée).
export class TtlSet {
  constructor({ ttlMs, maxSize = 50_000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.map = new Map();
  }

  // Retourne true si la clé est NOUVELLE (et l'enregistre), false si elle est encore valide.
  add(key, now = Date.now()) {
    const expires = this.map.get(key);
    if (expires && expires > now) return false;
    if (this.map.size >= this.maxSize) this.purge(now);
    if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value); // le plus ancien
    this.map.set(key, now + this.ttlMs);
    return true;
  }

  purge(now = Date.now()) {
    for (const [k, exp] of this.map) if (exp <= now) this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }
}
