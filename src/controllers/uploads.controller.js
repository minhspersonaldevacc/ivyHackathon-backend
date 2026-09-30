import { createHash, randomUUID } from "node:crypto";
import { extensionOf } from "../upload/config.js";
import { validateFile } from "../upload/validate.js";
import { extractGeometry } from "../services/geometry.service.js";
import { extractDocument } from "../services/document.service.js";
import { extractOrder, parseQuantity } from "../services/order.service.js";
import { compileManufacturingObject } from "../services/compiler.service.js";
import { validateUpload } from "../services/validation.service.js";

const GEOMETRY_EXTENSIONS = new Set([".step", ".stp", ".stl", ".obj", ".dxf", ".iges", ".igs"]);
const MIME_TYPES = { ".pdf": "application/pdf", ".step": "model/step", ".stp": "model/step", ".stl": "model/stl", ".obj": "model/obj", ".dxf": "application/dxf", ".iges": "model/iges", ".igs": "model/iges" };

export function createUploadsController({ repository, storage, languageProvider }) {
  async function extractGeometryStage(upload) {
    const geometries = [];
    for (const asset of upload.assets.filter((item) => item.assetType === "geometry")) {
      try { geometries.push(await extractGeometry(asset, storage)); }
      catch (error) { geometries.push({ assetId: asset.assetId, status: "failed", reason: error.message, features: [], featureDetectionStatus: "unavailable" }); }
    }
    await repository.saveGeometry(upload.uploadId, geometries);
    return geometries;
  }

  async function extractDocumentsStage(upload) {
    const documents = [];
    for (const asset of upload.assets.filter((item) => item.assetType === "technical_document")) {
      try { documents.push(await extractDocument(asset, storage)); }
      catch (error) { documents.push({ assetId: asset.assetId, status: "failed", reason: error.message, requirements: [] }); }
    }
    await repository.saveDocuments(upload.uploadId, documents);
    return documents;
  }

  async function extractOrderStage(upload, form = upload.rawCustomerInput) {
    const orderData = await extractOrder(form, { languageProvider });
    await repository.saveOrder(upload.uploadId, orderData);
    return orderData;
  }

  async function compileStage(uploadId) {
    const upload = await getUploadOrThrow(uploadId);
    const { issues, status } = compileManufacturingObject(upload);
    await repository.saveCompile(uploadId, issues, status);
    return validateUpload(await getUploadOrThrow(uploadId));
  }

  async function getUploadOrThrow(uploadId) {
    const upload = await repository.getUpload(uploadId);
    if (!upload) {
      const error = new Error("Upload not found.");
      error.status = 404;
      throw error;
    }
    return upload;
  }

  return {
    async create(req, res) {
      const form = { ...req.body };
      const files = req.files ?? {};
      const geometryFiles = files["geometry_files[]"] ?? [];
      const documentFiles = files["documents[]"] ?? [];
      if (form.quantity !== undefined && form.quantity !== "") parseQuantity(form.quantity);
      if ([...geometryFiles, ...documentFiles].reduce((total, file) => total + file.size, 0) > Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024)) {
        throw httpError(413, "Combined upload size exceeds MAX_UPLOAD_BYTES.");
      }
      for (const file of geometryFiles) {
        const extension = validateFile(file);
        if (!GEOMETRY_EXTENSIONS.has(extension)) throw httpError(415, `${file.originalname} is not a supported geometry format.`);
      }
      for (const file of documentFiles) {
        if (validateFile(file) !== ".pdf") throw httpError(415, `${file.originalname} is not a supported document format.`);
      }
      const uploadId = `UP-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      const assets = [];
      let uploadCreated = false;
      try {
        for (const [assetType, group] of [["geometry", geometryFiles], ["technical_document", documentFiles]]) {
          for (const file of group) {
            const assetId = `ASSET-${randomUUID()}`;
            const stored = await storage.put(uploadId, assetId, file);
            assets.push({
              assetId, uploadId, assetType, filename: file.originalname.split(/[\\/]/).pop().slice(0, 255),
              mimeType: MIME_TYPES[extensionOf(file.originalname)] ?? "application/octet-stream", storageKey: stored.key, storageUri: stored.uri,
              sizeBytes: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex"), status: "stored",
            });
          }
        }
        const upload = {
          uploadId, customerId: form.customer_id || null, projectName: form.project_name || null,
          status: "processing", rawCustomerInput: form, createdAt,
        };
        await repository.createUpload(upload, assets);
        uploadCreated = true;
        // The main route completes the local deterministic pipeline in one request.
        const persisted = await getUploadOrThrow(uploadId);
        await extractGeometryStage(persisted);
        await extractDocumentsStage(persisted);
        await extractOrderStage(persisted, form);
        const validation = await compileStage(uploadId);
        return res.status(201).json({ upload_id: uploadId, status: validation.status, assets: assets.map(assetResponse), manufacturing_object: validation.manufacturing_object, validation: { status: validation.status, fields: validation.fields, issues: validation.issues } });
      } catch (error) {
        if (!uploadCreated) await Promise.allSettled(assets.map((asset) => storage.delete(asset.storageKey)));
        throw error;
      }
    },

    async extractGeometry(req, res) {
      const upload = await getUploadOrThrow(req.params.uploadId);
      const geometries = await extractGeometryStage(upload);
      const failed = geometries.some((geometry) => geometry.status === "failed");
      res.status(failed ? 422 : 200).json({ upload_id: upload.uploadId, geometries });
    },

    async extractDocuments(req, res) {
      const upload = await getUploadOrThrow(req.params.uploadId);
      const documents = await extractDocumentsStage(upload);
      res.json({ upload_id: upload.uploadId, documents, requirements: documents.flatMap((document) => document.requirements ?? []) });
    },

    async extractOrder(req, res) {
      const upload = await getUploadOrThrow(req.params.uploadId);
      const orderData = await extractOrderStage(upload, { ...upload.rawCustomerInput, ...req.body });
      res.json({ upload_id: upload.uploadId, ...orderData });
    },

    async compile(req, res) {
      res.json({ upload_id: req.params.uploadId, ...(await compileStage(req.params.uploadId)) });
    },

    async validation(req, res) {
      res.json(await validateUpload(await getUploadOrThrow(req.params.uploadId)));
    },

    async get(req, res) {
      const upload = await getUploadOrThrow(req.params.uploadId);
      const validation = validateUpload(upload);
      res.json({ upload_id: upload.uploadId, status: upload.status, created_at: upload.createdAt, assets: upload.assets.map(assetResponse), manufacturing_object: validation.manufacturing_object });
    },

    async download(req, res) {
      const upload = await getUploadOrThrow(req.params.uploadId);
      const asset = upload.assets.find((item) => item.assetId === req.params.assetId);
      if (!asset) throw httpError(404, "Asset not found.");
      const bytes = await storage.get(asset.storageKey);
      res.setHeader("Content-Type", asset.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
      res.send(bytes);
    },
  };
}

function assetResponse(asset) {
  return { asset_id: asset.assetId, type: asset.assetType, filename: asset.filename, mime_type: asset.mimeType, storage_uri: asset.storageUri, status: asset.status };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
