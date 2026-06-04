import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";

/**
 * Multer rejects run before route handlers; without this middleware the global
 * error handler returns `{ message: "Internal Server Error" }` and hides the
 * real reason (file too large, wrong MIME type, etc.).
 */
export function handleMulterUploadErrors(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!err) {
    next();
    return;
  }
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Image is too large. Max 10 MB." });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(400).json({ error: "Upload rejected" });
}
