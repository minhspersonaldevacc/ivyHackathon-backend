import { randomUUID } from "node:crypto";
import { toMillimeters } from "../utils/units.js";

const sourced = (value, source, confidence = 1) => ({ value, source, confidence, status: "CONFIRMED" });

export function parseQuantity(value) {
  if (value === undefined || value === null || value === "") return null;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    const error = new Error("quantity must be a positive whole number.");
    error.status = 400;
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  return quantity;
}

export async function extractOrder(input, { languageProvider } = {}) {
  const quantity = parseQuantity(input.quantity);
  const deliveryDate = input.delivery_date || null;
  const deliveryTimestamp = deliveryDate ? Date.parse(`${deliveryDate}T00:00:00Z`) : null;
  if (deliveryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !Number.isFinite(deliveryTimestamp) || new Date(deliveryTimestamp).toISOString().slice(0, 10) !== deliveryDate)) {
    const error = new Error("delivery_date must use YYYY-MM-DD format.");
    error.status = 400;
    throw error;
  }
  const requirements = [];
  for (const field of ["material", "tolerance", "surface_finish"]) {
    if (input[field] !== undefined && input[field] !== "") {
      const rawValue = field === "tolerance" ? Number(input[field]) : String(input[field]).trim();
      if (field === "tolerance" && !Number.isFinite(rawValue)) {
        const error = new Error("tolerance must be a finite number.");
        error.status = 400;
        throw error;
      }
      const normalizedTolerance = field === "tolerance" && input.tolerance_unit ? toMillimeters(rawValue, input.tolerance_unit) : { value: rawValue, unit: input.tolerance_unit || null };
      requirements.push({
        requirementId: `REQ-${randomUUID()}`, field,
        value: field === "tolerance" ? normalizedTolerance.value : rawValue,
        ...(field === "tolerance" ? { unit: normalizedTolerance.unit } : {}),
        source: { type: "customer_form", field }, confidence: 1, status: "CONFIRMED",
      });
    }
  }

  let interpretation = { functionalRequirements: [], designConstraints: [], preferences: [], provider: "explicit-patterns" };
  if (languageProvider) interpretation = await languageProvider.interpret(input.description || "");
  else interpretation = interpretExplicitPatterns(input.description || "");

  return {
    order: {
      quantity: quantity === null ? { value: null, source: "customer_form", confidence: 1, status: "MISSING" } : sourced(quantity, "customer_form"),
      delivery: deliveryDate ? { requestedDate: deliveryDate, source: "customer_form", confidence: 1, status: "CONFIRMED" } : { requestedDate: null, source: "customer_form", confidence: 1, status: "MISSING" },
      notes: input.notes || null,
    },
    requirements,
    functionalRequirements: interpretation.functionalRequirements ?? [],
    designConstraints: interpretation.designConstraints ?? [],
    preferences: interpretation.preferences ?? [],
    interpretationProvider: interpretation.provider ?? "configured-provider",
    description: input.description || "",
  };
}

export function interpretExplicitPatterns(description) {
  const functionalRequirements = [];
  const designConstraints = [];
  const preferences = [];
  const load = description.match(/\b(?:support|supports|supporting|carry|carries)\s+(?:a\s+)?([0-9]+(?:\.[0-9]+)?)\s*(kg|g|lb|lbs)\b/i);
  if (load) functionalRequirements.push({ type: "support_load", value: Number(load[1]), unit: normalizeMassUnit(load[2]), source: "customer_description", confidence: 0.9, status: "EXTRACTED" });
  if (/\b(?:four|4)\s+mounting\s+holes?\b.{0,80}\b(?:cannot|can't|must not)\s+(?:move|change|shift)\b/i.test(description) || /\bmounting\s+holes?\b.{0,60}\b(?:fixed|unchanged|cannot move)\b/i.test(description)) {
    designConstraints.push({ target: "mounting_holes", constraint: "fixed_position", source: "customer_description", confidence: 0.9, status: "EXTRACTED" });
  }
  if (/\b(?:minimi[sz]e|reduce)\s+(?:the\s+)?weight\b|\blightweight\b/i.test(description)) {
    preferences.push({ objective: "minimize_weight", priority: "high", source: "customer_description", confidence: 0.9, status: "EXTRACTED" });
  }
  return { functionalRequirements, designConstraints, preferences, provider: "explicit-patterns" };
}

function normalizeMassUnit(unit) {
  const normalized = unit.toLowerCase();
  if (normalized === "g") return "g";
  if (normalized === "lb" || normalized === "lbs") return "lb";
  return "kg";
}
