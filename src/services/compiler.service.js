const REQUIRED_FIELDS = ["material", "tolerance", "surface_finish"];

export function compileManufacturingObject(upload) {
  const allRequirements = upload.documentRequirements.concat(upload.orderData?.requirements ?? []);
  const requirements = {};
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    const candidates = allRequirements.filter((item) => item.field === field);
    if (candidates.length === 0) {
      requirements[field] = { value: null, status: "MISSING", source: null, confidence: null };
      issues.push(issue(upload.uploadId, field, "missing", "review"));
      continue;
    }
    const distinct = new Map(candidates.map((candidate) => [normalized(candidate.value, candidate.unit), candidate]));
    if (distinct.size > 1) {
      const values = [...distinct.values()];
      requirements[field] = {
        value: null, status: "CONFLICT", source: null, confidence: null,
        candidates: values.map(({ value, unit, source, confidence, status }) => ({ value, ...(unit ? { unit } : {}), source, confidence, status })),
      };
      issues.push({ ...issue(upload.uploadId, field, "conflict", "blocking"), candidates: requirements[field].candidates });
      continue;
    }
    const candidate = candidates[0];
    requirements[field] = {
      value: candidate.value, ...(candidate.unit ? { unit: candidate.unit } : {}),
      source: candidate.source, confidence: candidate.confidence,
      sources: candidates.map(({ source, confidence, status }) => ({ source, confidence, status })),
      status: candidate.status === "LOW_CONFIDENCE" || candidate.confidence < 0.9 ? "LOW_CONFIDENCE" : candidate.status,
    };
    if (requirements[field].status === "LOW_CONFIDENCE") issues.push(issue(upload.uploadId, field, "low_confidence", "review"));
  }

  const order = upload.orderData?.order ?? null;
  if (!order?.quantity?.value) issues.push(issue(upload.uploadId, "quantity", "missing", "review"));
  if (!order?.delivery?.requestedDate) issues.push(issue(upload.uploadId, "delivery", "missing", "review"));
  const usableGeometry = upload.geometries.find((geometry) => geometry.status === "extracted") ?? null;
  const validationStatus = issues.some((entry) => entry.severity === "blocking") ? "needs_review" : issues.length ? "needs_review" : "validated";
  const object = {
    manufacturing_object_id: `MO-${upload.uploadId}`,
    upload: { upload_id: upload.uploadId, status: validationStatus },
    customer: { customer_id: upload.customerId || null, project_name: upload.projectName || null },
    source_assets: upload.assets.map((asset) => ({ asset_id: asset.assetId, type: asset.assetType, filename: asset.filename, storage_uri: asset.storageUri })),
    part: {
      classification: usableGeometry?.classification ?? { shapeClass: null, partFamily: null, rotationalSymmetry: null, status: "unavailable" },
      geometry: usableGeometry ? {
        dimensions: usableGeometry.dimensions,
        units: usableGeometry.units,
        volume: usableGeometry.volume,
        surface_area: usableGeometry.surfaceArea,
        watertight: usableGeometry.watertight ?? null,
        source: usableGeometry.source,
        confidence: usableGeometry.confidence ?? null,
        status: "EXTRACTED",
        features: usableGeometry.features ?? [],
        feature_detection_status: usableGeometry.featureDetectionStatus ?? "unavailable",
      } : null,
      shape_fingerprint: usableGeometry?.shapeFingerprint ?? null,
    },
    requirements,
    order: order ? {
      quantity: order.quantity,
      delivery: order.delivery,
      notes: order.notes,
    } : { quantity: { value: null, source: "customer_form", confidence: 1, status: "MISSING" }, delivery: { requestedDate: null, source: "customer_form", confidence: 1, status: "MISSING" }, notes: null },
    functional_requirements: upload.orderData?.functionalRequirements ?? [],
    design_constraints: upload.orderData?.designConstraints ?? [],
    preferences: upload.orderData?.preferences ?? [],
    validation: {
      status: validationStatus,
      missing: issues.filter((entry) => entry.type === "missing").map((entry) => entry.field),
      conflicts: issues.filter((entry) => entry.type === "conflict").map((entry) => entry.field),
      low_confidence: issues.filter((entry) => entry.type === "low_confidence").map((entry) => entry.field),
      issues,
    },
    extraction_capabilities: {
      documents: upload.documents.map(({ assetId, status, reason, pageCount }) => ({ asset_id: assetId, status, reason, page_count: pageCount ?? null })),
      geometry: upload.geometries.map(({ assetId, status, reason, notice }) => ({ asset_id: assetId, status, reason: reason ?? null, notice: notice ?? null })),
      natural_language: upload.orderData?.interpretationProvider ?? "unavailable",
    },
  };
  return { object, issues, status: validationStatus };
}

function issue(uploadId, field, type, severity) {
  return { issue_id: `ISSUE-${uploadId}-${field}-${type}`, field, type, severity, status: type === "conflict" ? "unresolved" : "open" };
}

function normalized(value, unit) {
  const canonicalValue = typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
  return `${canonicalValue}|${unit ?? ""}`;
}
