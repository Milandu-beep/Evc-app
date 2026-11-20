import { matchedData } from "express-validator";
import { unlink } from "node:fs/promises";
import * as albums from "../services/gallery/gallery.album.service.js";
import * as items from "../services/gallery/gallery.item.service.js";
import * as publicService from "../services/gallery/gallery.public.service.js";
import { ITEMS_PAGE_MAX } from "../services/gallery/gallery.common.js";
import { resolveLanguage } from "../services/events/event.public.service.js";
import AppError from "../utils/AppError.js";
import { HTTP_STATUS } from "../config/constants.js";
import { sendCreated, sendPaginated, sendSuccess } from "../utils/response.js";

// express-validator écarte de matchedData les champs scalaires « optional({ nullable: true }) » reçus à null :
// on les relit dans le corps pour que « { "coverImageId": null } » (effacer) soit pris en compte.
const NULLABLE_FIELDS = ["coverImageId", "linkedEventId"];

// Corps validé, sans traductions « fantômes » (langue absente ou vide ignorée, null = suppression).
function data(req) {
  const body = matchedData(req, { locations: ["body"] });
  for (const key of NULLABLE_FIELDS) if (req.body?.[key] === null) body[key] = null;
  if (body.translations) {
    const cleaned = {};
    for (const [lang, value] of Object.entries(body.translations)) {
      if (value === null) cleaned[lang] = null;
      else if (value && typeof value === "object") {
        const fields = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
        if (Object.keys(fields).length) cleaned[lang] = fields;
      }
    }
    body.translations = cleaned;
  }
  return body;
}
const params = (req) => matchedData(req, { locations: ["query"] });

// ---------------------------------------------------------------------------
// Administration : albums
// ---------------------------------------------------------------------------
export const albumList = async (req, res) => {
  const q = params(req);
  const { items: list, meta } = await albums.list({
    page: q.page ?? 1, limit: q.limit ?? 20, q: q.q, status: q.status, featured: q.featured, eventId: q.eventId,
    from: q.from, to: q.to, deleted: q.deleted ?? false, sort: q.sort ?? "sortOrder", order: q.order ?? "asc",
  });
  sendPaginated(res, list, meta);
};
export const albumGet = async (req, res) => sendSuccess(res, await albums.getById(req.params.id));
export const albumCreate = async (req, res) => sendCreated(res, await albums.create(data(req), req), "Album créé");
export const albumUpdate = async (req, res) => sendSuccess(res, await albums.update(req.params.id, data(req), req), "Album modifié");
export const albumTransition = (action, message) => async (req, res) => sendSuccess(res, await albums.transition(req.params.id, action, req), message);
export const albumRemove = async (req, res) => { await albums.remove(req.params.id, req); sendSuccess(res, null, "Album supprimé"); };
export const albumRestore = async (req, res) => sendSuccess(res, await albums.restore(req.params.id, req), "Album restauré");
export const albumReorder = async (req, res) => { await albums.reorder(data(req).ids, req); sendSuccess(res, null, "Ordre des albums enregistré"); };

// ---------------------------------------------------------------------------
// Administration : médias
// ---------------------------------------------------------------------------
export const itemList = async (req, res) => {
  const q = params(req);
  const { items: list, meta } = await items.list(req.params.id, { deleted: q.deleted ?? false, page: q.page ?? 1, limit: q.limit ?? 50 });
  sendPaginated(res, list, meta);
};
export const itemAttach = async (req, res) => {
  const body = data(req);
  sendCreated(res, await items.attach(req.params.id, body, req), "Médias ajoutés");
};

// Import multiple : multipart « files » (jusqu'à 20) + « tags » facultatif (séparés par des virgules).
export const itemImport = async (req, res) => {
  const files = req.files ?? [];
  try {
    if (!files.length) {
      throw new AppError("Aucun fichier reçu (champ « files »)", HTTP_STATUS.UNPROCESSABLE, [{ field: "files", message: "Au moins un fichier requis" }]);
    }
    const tags = String(req.body?.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 40) throw new AppError("Trop de tags", HTTP_STATUS.UNPROCESSABLE, [{ field: "tags", message: "40 tags au plus" }]);
    const report = await items.importFiles(req.params.id, files, { tags }, req);
    const status = report.created.length ? HTTP_STATUS.CREATED : report.failed.length ? HTTP_STATUS.UNPROCESSABLE : HTTP_STATUS.OK;
    res.status(status).json({
      success: report.created.length > 0 || report.failed.length === 0,
      message: `${report.created.length} média(s) ajouté(s), ${report.skipped.length} ignoré(s), ${report.failed.length} refusé(s)`,
      data: report,
    });
  } finally {
    // Le service supprime les fichiers qu'il a traités ; on supprime ceux qu'une erreur précoce aurait laissés.
    await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  }
};
export const itemUpdate = async (req, res) => sendSuccess(res, await items.update(req.params.id, data(req), req), "Média modifié");
export const itemReorder = async (req, res) => { await items.reorder(req.params.id, data(req).itemIds, req); sendSuccess(res, null, "Ordre des médias enregistré"); };
export const itemMove = async (req, res) => { const b = data(req); sendSuccess(res, await items.move(b.itemIds, b.toAlbumId, req), "Médias déplacés"); };
export const itemRemove = async (req, res) => { await items.remove(req.params.id, req); sendSuccess(res, null, "Média supprimé"); };
export const itemRestore = async (req, res) => sendSuccess(res, await items.restore(req.params.id, req), "Média restauré");
export const adminTags = async (req, res) => sendSuccess(res, await items.tags());

// ---------------------------------------------------------------------------
// Lecture publique (sans authentification)
// ---------------------------------------------------------------------------
const cache = (res) => res.set("Cache-Control", "public, max-age=60");

export const publicAlbums = async (req, res) => {
  const q = params(req);
  const { items: list, meta } = await publicService.listAlbums({
    lang: resolveLanguage(req), q: q.q, tags: q.tags, match: q.match ?? "all", eventId: q.eventId, featured: q.featured,
    from: q.from, to: q.to, sort: q.sort ?? "recent", page: q.page ?? 1, limit: q.limit ?? 12,
  });
  cache(res);
  sendPaginated(res, list, meta);
};

export const publicHome = async (req, res) => {
  const q = params(req);
  const result = await publicService.home({ lang: resolveLanguage(req), limit: q.limit ?? 6 });
  cache(res);
  sendSuccess(res, result);
};

export const publicAlbum = async (req, res) => {
  const q = params(req);
  const result = await publicService.getAlbumBySlug(req.params.slug, {
    lang: resolveLanguage(req), tags: q.tags, match: q.match ?? "all", type: q.type, page: q.page ?? 1, limit: Math.min(q.limit ?? 60, ITEMS_PAGE_MAX),
  });
  cache(res);
  res.json({ success: true, message: "OK", data: { ...result.album, items: result.items }, meta: result.meta });
};

export const publicItems = async (req, res) => {
  const q = params(req);
  const { items: list, meta } = await publicService.listItems({
    lang: resolveLanguage(req), q: q.q, tags: q.tags, match: q.match ?? "all", type: q.type, albumId: q.albumId, eventId: q.eventId,
    page: q.page ?? 1, limit: q.limit ?? 24,
  });
  cache(res);
  sendPaginated(res, list, meta);
};

export const publicTags = async (req, res) => { const t = await publicService.tags(); cache(res); sendSuccess(res, t); };

// GET /api/events/:slug/albums : albums liés à un événement
export const eventAlbums = async (req, res) => {
  const result = await publicService.albumsOfEvent(req.params.slug, resolveLanguage(req));
  cache(res);
  sendSuccess(res, result);
};
