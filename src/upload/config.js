export const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".step",
  ".stp",
  ".stl",
  ".obj",
  ".dxf",
  ".iges",
  ".igs",
]);

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);

export function extensionOf(filename) {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot).toLowerCase();
}
