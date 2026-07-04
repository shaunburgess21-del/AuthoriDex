import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";

/**
 * Multer rejects run before route handlers; without this middleware the global
 * error handler returns `{ message: "Internal Server Error" }` and hides the
 * real reason (file too large, wrong MIME type, etc.).
 *
 * Factory so each route can report its own size limit — the avatar/admin
 * uploads allow 10 MB while suggestion uploads cap at 2 MB.
 */
export function multerUploadErrorHandler(maxSizeLabel: string) {
  return function handleMulterUploadErrors(
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
        res.status(400).json({ error: `Image is too large. Max ${maxSizeLabel}.` });
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
  };
}

/** Default instance for the 10 MB `upload` used by avatar + admin image routes. */
export const handleMulterUploadErrors = multerUploadErrorHandler("10 MB");
