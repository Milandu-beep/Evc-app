import * as storageService from "../services/storage/storage.service.js";
import AppError from "../utils/AppError.js";
import { HTTP_STATUS } from "../config/constants.js";
import { sendCreated, sendSuccess } from "../utils/response.js";

// POST /api/storage/upload  (multipart : champs « file » et « folder »)
export const upload = async (req, res) => {
  if (!req.file) {
    throw new AppError("Aucun fichier reçu (champ « file »)", HTTP_STATUS.UNPROCESSABLE, [
      { field: "file", message: "Fichier requis" },
    ]);
  }
  const { file, reused } = await storageService.upload({
    file: req.file,
    folder: req.body?.folder,
    req,
  });
  const dto = storageService.toDto(file, { reused });
  return reused
    ? sendSuccess(res, dto, "Fichier déjà présent : réutilisé")
    : sendCreated(res, dto, "Fichier envoyé");
};

// DELETE /api/storage/:id
export const remove = async (req, res) => {
  await storageService.remove({ id: req.params.id, req });
  sendSuccess(res, null, "Fichier supprimé");
};
