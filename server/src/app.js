import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import env from "./config/env.js";
import { API_PREFIX } from "./config/constants.js";
import logger from "./utils/logger.js";
import routes from "./routes/index.js";
import notFound from "./middleware/notFound.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

app.disable("x-powered-by");
if (env.trustProxy !== false) app.set("trust proxy", env.trustProxy);

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(
  morgan(env.isProduction ? "combined" : "dev", {
    stream: { write: (line) => logger.info(line.trim()) },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(API_PREFIX, routes);

app.use(notFound);
app.use(errorHandler);

export default app;
