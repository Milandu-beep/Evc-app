import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadMany } from "../middleware/upload.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { ROLES } from "../config/constants.js";
import { idParam } from "../validators/common.js";
import {
  adminAlbumListRules, attachItemsRules, createAlbumRules, itemListRules, moveItemsRules,
  reorderAlbumsRules, reorderItemsRules, updateAlbumRules, updateItemRules,
} from "../validators/gallery.validator.js";
import * as c from "../controllers/gallery.controller.js";

// Gestion de la galerie : Admin et Super Admin. L'authentification passe AVANT la réception des fichiers.
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

// --- Albums (les routes fixes avant les routes en /:id) ---
router.get("/albums", adminAlbumListRules, validate, asyncHandler(c.albumList));
router.post("/albums", createAlbumRules, validate, asyncHandler(c.albumCreate));
router.put("/albums/order", reorderAlbumsRules, validate, asyncHandler(c.albumReorder));
router.get("/albums/:id", idParam(), validate, asyncHandler(c.albumGet));
router.patch("/albums/:id", idParam(), updateAlbumRules, validate, asyncHandler(c.albumUpdate));
router.delete("/albums/:id", idParam(), validate, asyncHandler(c.albumRemove));
router.post("/albums/:id/restore", idParam(), validate, asyncHandler(c.albumRestore));
router.post("/albums/:id/publish", idParam(), validate, asyncHandler(c.albumTransition("publish", "Album publié")));
router.post("/albums/:id/unpublish", idParam(), validate, asyncHandler(c.albumTransition("unpublish", "Album dépublié")));
router.post("/albums/:id/archive", idParam(), validate, asyncHandler(c.albumTransition("archive", "Album archivé")));
router.post("/albums/:id/unarchive", idParam(), validate, asyncHandler(c.albumTransition("unarchive", "Album désarchivé")));

// --- Médias d'un album ---
router.get("/albums/:id/items", idParam(), itemListRules, validate, asyncHandler(c.itemList));
router.post("/albums/:id/items", idParam(), attachItemsRules, validate, asyncHandler(c.itemAttach));
// Identifiant vérifié AVANT de recevoir les fichiers
router.post("/albums/:id/import", uploadLimiter, idParam(), validate, uploadMany, asyncHandler(c.itemImport));
router.put("/albums/:id/items/order", idParam(), reorderItemsRules, validate, asyncHandler(c.itemReorder));

// --- Médias (par identifiant) ---
router.post("/items/move", moveItemsRules, validate, asyncHandler(c.itemMove));
router.patch("/items/:id", idParam(), updateItemRules, validate, asyncHandler(c.itemUpdate));
router.delete("/items/:id", idParam(), validate, asyncHandler(c.itemRemove));
router.post("/items/:id/restore", idParam(), validate, asyncHandler(c.itemRestore));

router.get("/tags", asyncHandler(c.adminTags));

export default router;
