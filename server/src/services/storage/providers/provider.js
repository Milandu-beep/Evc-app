// Contrat commun à tous les fournisseurs de stockage (Cloudinary aujourd'hui, R2 demain).
// Le StorageService ne connaît que ces méthodes.
export default class StorageProvider {
  /** Nom stocké dans storage_files.provider (CLOUDINARY, R2…). */
  get name() {
    throw new Error("name non implémenté");
  }

  /**
   * Envoie un fichier local.
   * input : { path, publicId, resourceType: "IMAGE"|"VIDEO"|"RAW", bytes }
   * retour : { publicId, url, secureUrl, bytes, width?, height?, duration? }
   */
  // eslint-disable-next-line no-unused-vars
  async put(input) {
    throw new Error("put non implémenté");
  }

  /** Supprime un objet. Retourne true s'il existait, false s'il était déjà absent. */
  // eslint-disable-next-line no-unused-vars
  async destroy({ publicId, resourceType }) {
    throw new Error("destroy non implémenté");
  }

  /** Liste les objets sous un préfixe : [{ publicId, createdAt }] (détection des orphelins). */
  // eslint-disable-next-line no-unused-vars
  async list({ prefix, resourceType }) {
    throw new Error("list non implémenté");
  }

  /** URL HTTPS de lecture. options : { width, thumbnail } */
  // eslint-disable-next-line no-unused-vars
  urlFor(file, options = {}) {
    throw new Error("urlFor non implémenté");
  }
}
