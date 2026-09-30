import { Router } from "express";
import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../upload/config.js";

export function createUploadsRouter(controller) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 20, fields: 30, fieldSize: 1024 * 1024 },
  }).fields([
    { name: "geometry_files[]", maxCount: 10 },
    { name: "documents[]", maxCount: 10 },
  ]);

  router.post("/", upload, controller.create);
  router.get("/:uploadId", controller.get);
  router.post("/:uploadId/geometry/extract", controller.extractGeometry);
  router.post("/:uploadId/documents/extract", controller.extractDocuments);
  router.post("/:uploadId/order/extract", controller.extractOrder);
  router.post("/:uploadId/compile", controller.compile);
  router.get("/:uploadId/validation", controller.validation);
  router.get("/:uploadId/assets/:assetId/file", controller.download);
  return router;
}
