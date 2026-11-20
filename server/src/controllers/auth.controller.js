import * as authService from "../services/auth.service.js";
import * as auditService from "../services/audit.service.js";
import { sendSuccess } from "../utils/response.js";

export const login = async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  await auditService.record({
    action: "LOGIN",
    entity: "admins",
    entityId: result.admin.id,
    adminId: result.admin.id,
    req,
  });
  sendSuccess(res, result, "Connexion réussie");
};

export const me = async (req, res) => {
  const admin = await authService.getProfile(req.user.id);
  sendSuccess(res, admin);
};
