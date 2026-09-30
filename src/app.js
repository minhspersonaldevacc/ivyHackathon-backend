import express from "express";
import cors from "cors";
import { createUploadsController } from "./controllers/uploads.controller.js";
import { createUploadsRouter } from "./routes/uploads.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

export function createApp({ repository, storage, languageProvider, apiKey = process.env.API_KEY } = {}) {
  const app = express();
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((value) => value.trim());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1/uploads", (req, res, next) => {
    if (apiKey && req.get("authorization") !== `Bearer ${apiKey}`) return res.status(401).json({ error: "Unauthorized." });
    next();
  }, createUploadsRouter(createUploadsController({ repository, storage, languageProvider })));
  app.use(errorMiddleware);
  return app;
}
