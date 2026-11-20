import { HTTP_STATUS } from "../config/constants.js";

// Format JSON unique :
//   succès : { success: true,  message, data }
//   erreur : { success: false, message, errors? }
export const sendSuccess = (res, data = null, message = "OK", status = HTTP_STATUS.OK) =>
  res.status(status).json({ success: true, message, data });

export const sendCreated = (res, data = null, message = "Créé") =>
  sendSuccess(res, data, message, HTTP_STATUS.CREATED);

export const sendError = (res, message, status = HTTP_STATUS.INTERNAL_ERROR, errors = null) =>
  res.status(status).json({ success: false, message, ...(errors && { errors }) });

// Liste paginée : { success, message, data: [...], meta: { page, limit, total, totalPages } }
export const sendPaginated = (res, items, meta, message = "OK") =>
  res.status(HTTP_STATUS.OK).json({ success: true, message, data: items, meta });
