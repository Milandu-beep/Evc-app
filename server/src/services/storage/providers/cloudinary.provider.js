import { v2 as cloudinary } from "cloudinary";
import env from "../../../config/env.js";
import { THUMBNAIL_WIDTH } from "../../../config/storage.js";
import AppError from "../../../utils/AppError.js";
import logger from "../../../utils/logger.js";
import StorageProvider from "./provider.js";

const RESOURCE = { IMAGE: "image", VIDEO: "video", RAW: "raw" };
const LARGE_FILE_BYTES = 20 * 1024 * 1024; // au-delà : envoi par morceaux

export default class CloudinaryProvider extends StorageProvider {
  #configured = false;

  get name() {
    return "CLOUDINARY";
  }

  #configure() {
    if (this.#configured) return;
    const { cloudName, apiKey, apiSecret } = env.cloudinary;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new AppError("Stockage non configuré (variables CLOUDINARY_*)", 503);
    }
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this.#configured = true;
  }

  // Convertit une erreur Cloudinary en erreur HTTP propre ; le détail reste dans les logs.
  #fail(action, err) {
    if (err instanceof AppError) return err;
    const detail = err?.error?.message || err?.message || String(err);
    logger.error(`Cloudinary : échec ${action}`, detail);
    return new AppError("Service de stockage indisponible", 502);
  }

  async put({ path, publicId, resourceType, bytes }) {
    this.#configure();
    const options = {
      public_id: publicId,
      resource_type: RESOURCE[resourceType],
      type: "upload",
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    };

    let res;
    try {
      res =
        bytes > LARGE_FILE_BYTES
          ? await cloudinary.uploader.upload_large(path, { ...options, chunk_size: 6_000_000 })
          : await cloudinary.uploader.upload(path, options);
    } catch (err) {
      throw this.#fail("envoi", err);
    }
    if (res.error) throw this.#fail("envoi", res);

    return {
      publicId: res.public_id,
      url: res.url,
      secureUrl: res.secure_url,
      bytes: res.bytes,
      width: res.width || undefined,
      height: res.height || undefined,
      duration: res.duration || undefined,
    };
  }

  async destroy({ publicId, resourceType }) {
    this.#configure();
    try {
      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: RESOURCE[resourceType],
        type: "upload",
        invalidate: true,
      });
      return res.result === "ok";
    } catch (err) {
      throw this.#fail("suppression", err);
    }
  }

  async list({ prefix, resourceType }) {
    this.#configure();
    const items = [];
    let next;
    try {
      do {
        const res = await cloudinary.api.resources({
          resource_type: RESOURCE[resourceType],
          type: "upload",
          prefix,
          max_results: 500,
          next_cursor: next,
        });
        for (const r of res.resources) {
          items.push({ publicId: r.public_id, createdAt: new Date(r.created_at) });
        }
        next = res.next_cursor;
      } while (next);
    } catch (err) {
      throw this.#fail("listing", err);
    }
    return items;
  }

  // Images : WebP/AVIF automatique (f_auto) + compression adaptée (q_auto), sans agrandissement.
  // Vidéos : format et qualité automatiques ; miniature = image extraite de la vidéo.
  // Audio et PDF : URL directe.
  urlFor(file, { width, thumbnail = false } = {}) {
    this.#configure();
    const base = { secure: true, resource_type: RESOURCE[file.resourceType] };
    const isAudio = file.mimeType?.startsWith("audio/");

    if (file.resourceType === "IMAGE") {
      const transformation = [{ fetch_format: "auto", quality: "auto" }];
      const w = thumbnail ? THUMBNAIL_WIDTH : width;
      if (w) transformation.push({ width: w, crop: "limit" });
      return cloudinary.url(file.publicId, { ...base, transformation });
    }

    if (file.resourceType === "VIDEO" && !isAudio) {
      if (thumbnail) {
        return cloudinary.url(file.publicId, {
          ...base,
          format: "jpg",
          transformation: [
            { start_offset: "auto" },
            { quality: "auto", width: width || THUMBNAIL_WIDTH, crop: "limit" },
          ],
        });
      }
      return cloudinary.url(file.publicId, {
        ...base,
        transformation: [{ fetch_format: "auto", quality: "auto" }],
      });
    }

    return cloudinary.url(file.publicId, base); // audio, PDF (publicId déjà avec extension)
  }
}
