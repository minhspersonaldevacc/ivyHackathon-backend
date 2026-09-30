import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { toMillimeters } from "../utils/units.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

function requirement(field, value, unit, asset, confidence) {
  return {
    requirementId: `REQ-${randomUUID()}`,
    field,
    value,
    ...(unit ? { unit } : {}),
    source: { type: "document", assetId: asset.assetId, filename: asset.filename, page: null },
    confidence,
    status: confidence < 0.9 ? "LOW_CONFIDENCE" : "EXTRACTED",
  };
}

export async function extractDocument(asset, storage) {
  if (!asset.filename.toLowerCase().endsWith(".pdf")) {
    return { assetId: asset.assetId, status: "unavailable", reason: "Text extraction is currently supported for PDF documents only.", requirements: [] };
  }
  const bytes = await storage.get(asset.storageKey);
  const parsed = await pdfParse(bytes);
  const text = parsed.text.replace(/\s+/g, " ").trim();
  const requirements = [];
  const material = text.match(/\bmaterial\s*[:=-]?\s*([A-Za-z][A-Za-z0-9 .,+()/-]{1,60}?)(?=\s{2,}|\b(?:tolerance|finish|surface|quantity)\b|$)/i);
  if (material) requirements.push(requirement("material", material[1].trim().replace(/[.,;]+$/, ""), null, asset, 0.88));
  const tolerance = text.match(/\b(?:tolerance|tol\.)\s*[:=]?\s*(?:±|\+\/\-\s*)?([0-9]+(?:\.[0-9]+)?)\s*(mm|millimeters?|µm|um|in(?:ches?)?)\b/i);
  if (tolerance) {
    const normalized = toMillimeters(Number(tolerance[1]), normalizeLengthUnit(tolerance[2]));
    requirements.push(requirement("tolerance", normalized.value, normalized.unit, asset, 0.9));
  }
  const finish = text.match(/\b(?:surface\s+finish|finish)\s*[:=-]?\s*([^;,.]{1,50})/i);
  if (finish) requirements.push(requirement("surface_finish", finish[1].trim(), null, asset, 0.85));
  return {
    assetId: asset.assetId,
    status: text ? "extracted" : "unavailable",
    pageCount: parsed.numpages,
    text,
    requirements,
    reason: text ? null : "No text layer was found. OCR is not configured.",
  };
}

function normalizeLengthUnit(value) {
  const unit = value.toLowerCase();
  if (unit === "µm" || unit === "um") return "um";
  if (unit.startsWith("in")) return "in";
  return "mm";
}
