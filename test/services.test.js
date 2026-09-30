import { test } from "node:test";
import assert from "node:assert/strict";
import { compileManufacturingObject } from "../src/services/compiler.service.js";
import { extractGeometry } from "../src/services/geometry.service.js";
import { interpretExplicitPatterns, parseQuantity } from "../src/services/order.service.js";

test("quantity parser rejects zero and fractional quantities", () => {
  assert.throws(() => parseQuantity("0"), { code: "INVALID_QUANTITY" });
  assert.throws(() => parseQuantity("1.5"), { code: "INVALID_QUANTITY" });
  assert.equal(parseQuantity("500"), 500);
});

test("explicit description rules keep function, constraint, and preference distinct", () => {
  const result = interpretExplicitPatterns("Bracket supports a 4 kg motor. Four mounting holes cannot move. Minimize weight.");
  assert.equal(result.functionalRequirements[0].value, 4);
  assert.equal(result.functionalRequirements[0].type, "support_load");
  assert.equal(result.designConstraints[0].constraint, "fixed_position");
  assert.equal(result.preferences[0].objective, "minimize_weight");
  assert.equal(result.provider, "explicit-patterns");
});

test("OBJ geometry returns measured bounds and no fabricated features", async () => {
  const bytes = Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n");
  const result = await extractGeometry({ assetId: "A1", filename: "tetra.obj", storageKey: "A1.obj" }, { get: async () => bytes });
  assert.deepEqual(result.dimensions, { x: 1, y: 1, z: 1 });
  assert.equal(result.status, "extracted");
  assert.equal(result.watertight, true);
  assert.equal(result.features.length, 0);
  assert.equal(result.featureDetectionStatus, "unavailable");
});

test("compiler preserves conflicting candidates and missing fields", () => {
  const result = compileManufacturingObject({
    uploadId: "UP-1", customerId: null, projectName: null, assets: [], geometries: [], documents: [],
    documentRequirements: [{ field: "material", value: "Aluminum 7075", source: { type: "document" }, confidence: 0.9, status: "EXTRACTED" }],
    orderData: {
      order: { quantity: { value: 10, status: "CONFIRMED" }, delivery: { requestedDate: null, status: "MISSING" } },
      requirements: [{ field: "material", value: "Aluminum 6061", source: { type: "customer_form" }, confidence: 1, status: "CONFIRMED" }],
    },
  });
  assert.equal(result.object.requirements.material.status, "CONFLICT");
  assert.equal(result.object.requirements.material.candidates.length, 2);
  assert.equal(result.object.requirements.surface_finish.status, "MISSING");
  assert.ok(result.issues.some((issue) => issue.field === "material" && issue.type === "conflict"));
});
