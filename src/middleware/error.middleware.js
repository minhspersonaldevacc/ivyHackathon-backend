import multer from "multer";

export function errorMiddleware(error, _req, res, _next) {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? "Internal server error." : error.message, ...(error.code ? { code: error.code } : {}) });
}
