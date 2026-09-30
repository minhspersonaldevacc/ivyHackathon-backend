import { compileManufacturingObject } from "./compiler.service.js";

export function validateUpload(upload) {
  const { object, issues, status } = compileManufacturingObject(upload);
  const fields = Object.fromEntries(Object.entries(object.requirements).map(([field, requirement]) => [field, requirement.status.toLowerCase()]));
  fields.quantity = object.order.quantity.status.toLowerCase();
  fields.delivery = object.order.delivery.status.toLowerCase();
  fields.geometry = upload.geometries.some((geometry) => geometry.status === "extracted") ? "confirmed" : upload.assets.some((asset) => asset.assetType === "geometry") ? "unavailable" : "missing";
  return { upload_id: upload.uploadId, status, fields, issues, manufacturing_object: object };
}
