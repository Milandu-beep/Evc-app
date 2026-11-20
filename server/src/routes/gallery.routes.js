import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import validate from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { publicAlbumDetailRules, publicAlbumListRules, publicHomeRules, publicItemListRules } from "../validators/gallery.validator.js";
import * as c from "../controllers/gallery.controller.js";

// Consultation publique de la galerie (sans authentification).
const router = Router();
router.use(publicLimiter);

router.get("/home", publicHomeRules, validate, asyncHandler(c.publicHome)); // albums mis en avant + récents
router.get("/albums", publicAlbumListRules, validate, asyncHandler(c.publicAlbums));
router.get("/albums/:slug", publicAlbumDetailRules, validate, asyncHandler(c.publicAlbum));
router.get("/items", publicItemListRules, validate, asyncHandler(c.publicItems)); // recherche transversale
router.get("/tags", asyncHandler(c.publicTags));

export default router;
