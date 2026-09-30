import { extensionOf, SUPPORTED_EXTENSIONS } from "./config.js";

const signatures = {
  ".pdf": (bytes) => bytes.subarray(0, 5).toString("ascii") === "%PDF-",
  ".step": (bytes) => bytes.subarray(0, 64).toString("ascii").includes("ISO-10303-21"),
  ".stp": (bytes) => bytes.subarray(0, 64).toString("ascii").includes("ISO-10303-21"),
  ".dxf": (bytes) => /^(?:0\r?\nSECTION|999\r?\n)/i.test(bytes.toString("ascii", 0, Math.min(bytes.length, 128)).trimStart()),
  ".iges": (bytes) => bytes.length >= 6,
  ".igs": (bytes) => bytes.length >= 6,
  ".stl": (bytes) => bytes.length >= 15,
  ".obj": (bytes) => /(^|\n)\s*(v|o|g)\s/m.test(bytes.toString("utf8", 0, Math.min(bytes.length, 4096))),
};

export function validateFile(file) {
  const extension = extensionOf(file.originalname);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    const error = new Error(`Unsupported file type. Supported extensions: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
    error.status = 415;
    throw error;
  }

  if (file.size === 0) {
    const error = new Error("The uploaded file is empty.");
    error.status = 400;
    throw error;
  }

  if (!signatures[extension](file.buffer)) {
    const error = new Error(`The file contents do not look like a valid ${extension} file.`);
    error.status = 400;
    throw error;
  }

  return extension;
}
