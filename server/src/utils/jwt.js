import jwt from "jsonwebtoken";
import env from "../config/env.js";

// Algorithme imposé à la signature et à la vérification : jamais celui annoncé par le token.
const ALGORITHM = "HS256";

export const signToken = (payload) =>
  jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn, algorithm: ALGORITHM });

export const verifyToken = (token) => jwt.verify(token, env.jwt.secret, { algorithms: [ALGORITHM] });
