import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { MemoryUploadRepository } from "../src/database/repository.js";
import { LocalStorageService } from "../src/services/storage.service.js";

let server;
let baseUrl;
let storage;
let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "manufacturing-upload-test-"));
  storage = new LocalStorageService(tempRoot);
  server = createApp({ repository: new MemoryUploadRepository(), storage, apiKey: "" }).listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

test("normal upload returns a validated ManufacturingObject envelope", async () => {
  const response = await upload({ quantity: "500", material: "Aluminum 6061-T6", tolerance: "0.025", tolerance_unit: "mm", surface_finish: "Ra 3.2", delivery_date: "2026-11-15" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.manufacturing_object.order.quantity.value, 500);
  assert.equal(body.manufacturing_object.requirements.material.value, "Aluminum 6061-T6");
  assert.equal(body.manufacturing_object.validation.status, "validated");
});

test("upload with only CAD computes mesh measurements for OBJ", async () => {
  const response = await upload({}, { geometry: [objFile()] });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.assets[0].type, "geometry");
  const uploadState = await (await fetch(`${baseUrl}/api/v1/uploads/${body.upload_id}`)).json();
  assert.equal(uploadState.manufacturing_object.part.geometry.units, "source_units_unknown");
  assert.equal(uploadState.manufacturing_object.part.geometry.feature_detection_status, "unavailable");
});

test("upload with only PDF documents preserves the original and extracts text", async () => {
  const response = await upload({}, { documents: [pdfFile("Material: Aluminum 7075") ] });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.assets[0].type, "technical_document");
  const extraction = await (await fetch(`${baseUrl}/api/v1/uploads/${body.upload_id}/documents/extract`, { method: "POST" })).json();
  assert.match(extraction.documents[0].text, /Material: Aluminum 7075/);
  assert.equal(extraction.requirements[0].source.assetId, body.assets[0].asset_id);
  const downloaded = await fetch(`${baseUrl}/api/v1/uploads/${body.upload_id}/assets/${body.assets[0].asset_id}/file`);
  assert.equal(downloaded.status, 200);
});

test("missing material stays missing", async () => {
  const body = await (await upload({ quantity: "2", delivery_date: "2026-11-15" })).json();
  assert.equal(body.manufacturing_object.requirements.material.value, null);
  assert.equal(body.manufacturing_object.requirements.material.status, "MISSING");
});

test("different customer and drawing materials are retained as a conflict", async () => {
  const response = await upload({ material: "Aluminum 6061" }, { documents: [pdfFile("Material: Aluminum 7075")] });
  const body = await response.json();
  assert.equal(body.manufacturing_object.requirements.material.status, "CONFLICT");
  assert.equal(body.manufacturing_object.requirements.material.value, null);
  assert.equal(body.manufacturing_object.requirements.material.candidates.length, 2);
});

test("missing surface finish is reported by validation", async () => {
  const response = await upload({ material: "Aluminum 6061" });
  const body = await response.json();
  assert.equal(body.manufacturing_object.requirements.surface_finish.status, "MISSING");
  assert.ok(body.validation.issues.some((issue) => issue.field === "surface_finish" && issue.type === "missing"));
});

test("unsupported extension is rejected", async () => {
  const response = await upload({}, { geometry: [{ name: "drawing.exe", type: "application/octet-stream", body: "MZ fake binary" }] });
  assert.equal(response.status, 415);
});

test("failed mesh parsing reports an error and preserves the original upload", async () => {
  const response = await upload({}, { geometry: [{ name: "broken.obj", type: "text/plain", body: "v 0 0 0\n" }] });
  const body = await response.json();
  assert.equal(body.assets.length, 1);
  const rerun = await fetch(`${baseUrl}/api/v1/uploads/${body.upload_id}/geometry/extract`, { method: "POST" });
  assert.equal(rerun.status, 422);
  const stored = await fetch(`${baseUrl}/api/v1/uploads/${body.upload_id}/assets/${body.assets[0].asset_id}/file`);
  assert.equal(await stored.text(), "v 0 0 0\n");
});

test("invalid quantity is rejected before creating an upload", async () => {
  const response = await upload({ quantity: "0" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_QUANTITY");
});

test("missing delivery date is represented as missing", async () => {
  const response = await upload({ quantity: "2" });
  const body = await response.json();
  assert.equal(body.manufacturing_object.order.delivery.status, "MISSING");
  assert.ok(body.manufacturing_object.validation.missing.includes("delivery"));
});

test("explicit but weakly matched document material is marked low confidence", async () => {
  const response = await upload({}, { documents: [pdfFile("Material: Aluminum 7075")] });
  const body = await response.json();
  assert.equal(body.manufacturing_object.requirements.material.status, "LOW_CONFIDENCE");
  assert.ok(body.manufacturing_object.validation.low_confidence.includes("material"));
});

async function upload(fields = {}, files = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files.geometry ?? []) form.append("geometry_files[]", new Blob([file.body], { type: file.type }), file.name);
  for (const file of files.documents ?? []) form.append("documents[]", new Blob([file.body], { type: file.type }), file.name);
  return fetch(`${baseUrl}/api/v1/uploads`, { method: "POST", body: form });
}

function objFile() {
  return { name: "tetra.obj", type: "text/plain", body: "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n" };
}

function pdfFile(text) {
  const escape = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escape}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return { name: "drawing.pdf", type: "application/pdf", body: Buffer.from(pdf) };
}
