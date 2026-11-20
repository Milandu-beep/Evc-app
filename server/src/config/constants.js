export const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
});

// Rôles définis dans la charte (section 4).
export const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
});

// Langues définies dans la charte (section 9).
export const LANGUAGES = Object.freeze({ FR: "fr", EN: "en" });
export const DEFAULT_LANGUAGE = LANGUAGES.FR;

export const API_PREFIX = "/api";
export const API_VERSION = "1.0.0";
