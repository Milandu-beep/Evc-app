import * as authService from "../services/auth.service.js";
import { sendSuccess } from "../utils/response.js";

export const login = async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  sendSuccess(res, result, "Connexion réussie");
};

export const me = async (req, res) => {
  const admin = await authService.getProfile(req.user.id);
  sendSuccess(res, admin);
};
