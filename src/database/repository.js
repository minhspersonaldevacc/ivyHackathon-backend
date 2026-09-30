import { randomUUID } from "node:crypto";

export class MemoryUploadRepository {
  #uploads = new Map();

  async initialize() {}
  async close() {}

  async createUpload(upload, assets) {
    this.#uploads.set(upload.uploadId, {
      ...upload, assets, geometries: [], documents: [], documentRequirements: [], orderData: null, issues: [],
    });
  }

  async getUpload(uploadId) { return structuredClone(this.#uploads.get(uploadId) ?? null); }

  async saveGeometry(uploadId, geometries) {
    const upload = this.#required(uploadId);
    upload.geometries = geometries;
  }

  async saveDocuments(uploadId, documents) {
    const upload = this.#required(uploadId);
    upload.documents = documents.map(({ requirements, ...document }) => document);
    upload.documentRequirements = documents.flatMap((document) => document.requirements);
  }

  async saveOrder(uploadId, orderData) { this.#required(uploadId).orderData = orderData; }

  async saveCompile(uploadId, issues, status) {
    const upload = this.#required(uploadId);
    upload.issues = issues;
    upload.status = status;
  }

  async listUploads({ limit = 50, offset = 0 } = {}) {
    return [...this.#uploads.values()].slice(offset, offset + limit).map(({ uploadId, customerId, projectName, status, createdAt, assets }) => ({ uploadId, customerId, projectName, status, createdAt, assets }));
  }

  #required(uploadId) {
    const upload = this.#uploads.get(uploadId);
    if (!upload) {
      const error = new Error("Upload not found.");
      error.status = 404;
      throw error;
    }
    return upload;
  }
}

export class PostgresUploadRepository {
  constructor(pool) { this.pool = pool; }

  async initialize() {
    await this.pool.query("SELECT 1");
  }
  async close() { await this.pool.end(); }

  async createUpload(upload, assets) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO uploads (upload_id, customer_id, project_name, status, raw_customer_input, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [upload.uploadId, upload.customerId, upload.projectName, upload.status, upload.rawCustomerInput, upload.createdAt],
      );
      for (const asset of assets) await insertAsset(client, upload.uploadId, asset);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getUpload(uploadId) {
    const { rows: uploadRows } = await this.pool.query("SELECT * FROM uploads WHERE upload_id=$1", [uploadId]);
    if (!uploadRows[0]) return null;
    const upload = uploadRows[0];
    const [assetRows, geometryRows, documentRows, requirementRows, orderRows, functionalRows, constraintRows, preferenceRows, issueRows] = await Promise.all([
      this.pool.query("SELECT * FROM assets WHERE upload_id=$1 ORDER BY asset_id", [uploadId]),
      this.pool.query("SELECT * FROM geometry WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM document_extractions WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM requirements WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM orders WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM functional_requirements WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM design_constraints WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM preferences WHERE upload_id=$1", [uploadId]),
      this.pool.query("SELECT * FROM validation_issues WHERE upload_id=$1", [uploadId]),
    ]);
    const assets = assetRows.rows.map((row) => ({ assetId: row.asset_id, uploadId, assetType: row.asset_type, filename: row.filename, mimeType: row.mime_type, storageKey: row.storage_key, storageUri: row.storage_uri, sizeBytes: Number(row.size_bytes), sha256: row.sha256.trim(), status: row.status }));
    const featureRows = await this.pool.query("SELECT mf.*,g.asset_id FROM manufacturing_features mf JOIN geometry g USING(geometry_id) WHERE g.upload_id=$1", [uploadId]);
    const fingerprintRows = await this.pool.query("SELECT sf.*,g.asset_id FROM shape_fingerprints sf JOIN geometry g USING(geometry_id) WHERE g.upload_id=$1", [uploadId]);
    const geometries = geometryRows.rows.map((row) => {
      const fingerprint = fingerprintRows.rows.find((item) => item.asset_id === row.asset_id);
      return { geometryId: row.geometry_id, assetId: row.asset_id, status: row.extraction_status, units: row.units, dimensions: row.dimensions, volume: row.volume, surfaceArea: row.surface_area, triangleCount: row.triangle_count, watertight: row.watertight, classification: row.classification, featureDetectionStatus: row.feature_detection_status, features: featureRows.rows.filter((feature) => feature.asset_id === row.asset_id).map((feature) => ({ featureId: feature.feature_id, type: feature.feature_type, count: feature.quantity, parameters: feature.parameters, confidence: feature.confidence })), shapeFingerprint: fingerprint ? { planarRatio: fingerprint.planar_ratio, curvedSurfaceRatio: fingerprint.curved_surface_ratio, boundingBoxFill: fingerprint.bounding_box_fill, criticalPoints: fingerprint.critical_points, embedding: fingerprint.embedding } : null, source: row.source, confidence: row.confidence, notice: row.notice };
    });
    const documents = documentRows.rows.map((row) => ({ assetId: row.asset_id, status: row.extraction_status, pageCount: row.page_count, text: row.extracted_text, reason: row.reason }));
    const documentRequirements = requirementRows.rows.filter((row) => row.source?.type === "document").map((row) => ({ requirementId: row.requirement_id, field: row.field, value: row.value, unit: row.unit, source: row.source, confidence: row.confidence, status: row.status }));
    const orderRow = orderRows.rows[0];
    const orderData = orderRow ? {
      order: {
        quantity: { value: orderRow.quantity, source: orderRow.quantity_source, confidence: orderRow.quantity_confidence, status: orderRow.quantity === null ? "MISSING" : "CONFIRMED" },
        delivery: { requestedDate: orderRow.delivery_date?.toISOString?.().slice(0, 10) ?? (orderRow.delivery_date ? String(orderRow.delivery_date).slice(0, 10) : null), source: orderRow.delivery_source, confidence: orderRow.delivery_confidence, status: orderRow.delivery_date ? "CONFIRMED" : "MISSING" },
        notes: orderRow.notes,
      },
      requirements: requirementRows.rows.filter((row) => row.source?.type === "customer_form").map((row) => ({ requirementId: row.requirement_id, field: row.field, value: row.value, unit: row.unit, source: row.source, confidence: row.confidence, status: row.status })),
      functionalRequirements: functionalRows.rows.map((row) => ({ type: row.requirement_type, value: row.value, unit: row.unit, source: row.source, confidence: row.confidence })),
      designConstraints: constraintRows.rows.map((row) => ({ target: row.target, constraint: row.constraint_type, source: row.source, confidence: row.confidence })),
      preferences: preferenceRows.rows.map((row) => ({ objective: row.objective, priority: row.priority, source: row.source, confidence: row.confidence })),
      interpretationProvider: orderRow.interpretation_provider,
      description: orderRow.description ?? "",
    } : null;
    return {
      uploadId, customerId: upload.customer_id, projectName: upload.project_name, status: upload.status,
      rawCustomerInput: upload.raw_customer_input, createdAt: new Date(upload.created_at).toISOString(), assets,
      geometries, documents, documentRequirements, orderData,
      issues: issueRows.rows.map((row) => ({ issue_id: row.issue_id, field: row.field, type: row.issue_type, severity: row.severity, status: row.status, candidates: row.candidates })),
    };
  }

  async saveGeometry(uploadId, geometries) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM geometry WHERE upload_id=$1", [uploadId]);
      for (const geometry of geometries) {
        const assetId = geometry.assetId;
        const geometryId = geometry.geometryId ?? `GEO-${assetId}`;
        await client.query(`INSERT INTO geometry
          (geometry_id,upload_id,asset_id,dimensions,units,volume,surface_area,triangle_count,watertight,classification,feature_detection_status,extraction_status,source,confidence,notice)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [geometryId, uploadId, assetId, geometry.dimensions ? JSON.stringify(geometry.dimensions) : null, geometry.units ?? null, geometry.volume ?? null, geometry.surfaceArea ?? null, geometry.triangleCount ?? null, geometry.watertight ?? null, geometry.classification ? JSON.stringify(geometry.classification) : null, geometry.featureDetectionStatus ?? "unavailable", geometry.status, JSON.stringify(geometry.source ?? { type: "geometry_asset", assetId }), geometry.confidence ?? null, geometry.notice ?? geometry.reason ?? null]);
        for (const feature of geometry.features ?? []) await client.query("INSERT INTO manufacturing_features (feature_id,geometry_id,feature_type,quantity,parameters,confidence) VALUES ($1,$2,$3,$4,$5,$6)", [feature.featureId ?? `FEAT-${randomUUID()}`, geometryId, feature.type, feature.count, JSON.stringify(feature.parameters ?? {}), feature.confidence ?? null]);
        if (geometry.shapeFingerprint) await client.query("INSERT INTO shape_fingerprints (fingerprint_id,geometry_id,planar_ratio,curved_surface_ratio,bounding_box_fill,critical_points,embedding) VALUES ($1,$2,$3,$4,$5,$6,$7)", [`FP-${randomUUID()}`, geometryId, geometry.shapeFingerprint.planarRatio, geometry.shapeFingerprint.curvedSurfaceRatio, geometry.shapeFingerprint.boundingBoxFill, JSON.stringify(geometry.shapeFingerprint.criticalPoints ?? []), geometry.shapeFingerprint.embedding ?? []]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async saveDocuments(uploadId, documents) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM document_extractions WHERE upload_id=$1", [uploadId]);
      await client.query("DELETE FROM requirements WHERE upload_id=$1 AND source->>'type'='document'", [uploadId]);
      for (const document of documents) {
        await client.query("INSERT INTO document_extractions (asset_id,upload_id,extraction_status,page_count,extracted_text,reason) VALUES ($1,$2,$3,$4,$5,$6)", [document.assetId, uploadId, document.status, document.pageCount ?? null, document.text ?? null, document.reason ?? null]);
        for (const requirement of document.requirements ?? []) await insertRequirement(client, uploadId, requirement);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async saveOrder(uploadId, orderData) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const order = orderData.order;
      await client.query(`INSERT INTO orders (order_id,upload_id,quantity,quantity_source,quantity_confidence,delivery_date,delivery_source,delivery_confidence,notes,description,interpretation_provider)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (upload_id) DO UPDATE SET quantity=EXCLUDED.quantity, quantity_source=EXCLUDED.quantity_source, quantity_confidence=EXCLUDED.quantity_confidence, delivery_date=EXCLUDED.delivery_date, delivery_source=EXCLUDED.delivery_source, delivery_confidence=EXCLUDED.delivery_confidence, notes=EXCLUDED.notes, description=EXCLUDED.description, interpretation_provider=EXCLUDED.interpretation_provider`,
        [`ORDER-${randomUUID()}`, uploadId, order.quantity.value, order.quantity.source, order.quantity.confidence, order.delivery.requestedDate, order.delivery.source, order.delivery.confidence, order.notes, orderData.description, orderData.interpretationProvider]);
      await client.query("DELETE FROM requirements WHERE upload_id=$1 AND source->>'type'='customer_form'", [uploadId]);
      for (const requirement of orderData.requirements) await insertRequirement(client, uploadId, requirement);
      for (const table of ["functional_requirements", "design_constraints", "preferences"]) await client.query(`DELETE FROM ${table} WHERE upload_id=$1`, [uploadId]);
      for (const item of orderData.functionalRequirements) await client.query("INSERT INTO functional_requirements (id,upload_id,requirement_type,value,unit,source,confidence) VALUES ($1,$2,$3,$4,$5,$6,$7)", [`FR-${crypto.randomUUID()}`, uploadId, item.type, JSON.stringify(item.value), item.unit ?? null, item.source, item.confidence]);
      for (const item of orderData.designConstraints) await client.query("INSERT INTO design_constraints (id,upload_id,target,constraint_type,source,confidence) VALUES ($1,$2,$3,$4,$5,$6)", [`DC-${crypto.randomUUID()}`, uploadId, item.target, item.constraint, item.source, item.confidence]);
      for (const item of orderData.preferences) await client.query("INSERT INTO preferences (id,upload_id,objective,priority,source,confidence) VALUES ($1,$2,$3,$4,$5,$6)", [`PREF-${crypto.randomUUID()}`, uploadId, item.objective, item.priority, item.source, item.confidence]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async saveCompile(uploadId, issues, status) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM validation_issues WHERE upload_id=$1", [uploadId]);
      for (const entry of issues) await client.query("INSERT INTO validation_issues (issue_id,upload_id,field,issue_type,severity,status,candidates) VALUES ($1,$2,$3,$4,$5,$6,$7)", [entry.issue_id, uploadId, entry.field, entry.type, entry.severity, entry.status, entry.candidates ? JSON.stringify(entry.candidates) : null]);
      await client.query("UPDATE uploads SET status=$2 WHERE upload_id=$1", [uploadId, status]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async listUploads({ limit = 50, offset = 0 } = {}) {
    const { rows } = await this.pool.query("SELECT u.upload_id,u.customer_id,u.project_name,u.status,u.created_at,a.asset_id,a.asset_type,a.filename,a.storage_uri,a.status AS asset_status FROM uploads u LEFT JOIN assets a USING(upload_id) ORDER BY u.created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.upload_id)) grouped.set(row.upload_id, { uploadId: row.upload_id, customerId: row.customer_id, projectName: row.project_name, status: row.status, createdAt: new Date(row.created_at).toISOString(), assets: [] });
      if (row.asset_id) grouped.get(row.upload_id).assets.push({ assetId: row.asset_id, assetType: row.asset_type, filename: row.filename, storageUri: row.storage_uri, status: row.asset_status });
    }
    return [...grouped.values()];
  }
}

async function insertAsset(client, uploadId, asset) {
  await client.query("INSERT INTO assets (asset_id,upload_id,asset_type,filename,mime_type,storage_key,storage_uri,size_bytes,sha256,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [asset.assetId, uploadId, asset.assetType, asset.filename, asset.mimeType, asset.storageKey, asset.storageUri, asset.sizeBytes, asset.sha256, asset.status]);
}

async function insertRequirement(client, uploadId, requirement) {
  await client.query("INSERT INTO requirements (requirement_id,upload_id,field,value,unit,source,confidence,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [requirement.requirementId, uploadId, requirement.field, JSON.stringify(requirement.value), requirement.unit ?? null, JSON.stringify(requirement.source), requirement.confidence, requirement.status]);
}

export async function createRepository(env = process.env) {
  if (!env.DATABASE_URL) return new MemoryUploadRepository();
  const pgModule = await import("pg");
  const Pool = pgModule.Pool ?? pgModule.default.Pool;
  return new PostgresUploadRepository(new Pool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined }));
}
