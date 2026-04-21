import type { Response } from "express";
import { ZodError } from "zod";

/**
 * Standardized API error shape.
 *
 * Why this exists: routes.ts currently hand-rolls error responses in a dozen
 * different shapes — sometimes `{ error: "..." }`, sometimes `{ message: "..." }`,
 * sometimes both, and occasionally with a `code` field — which makes the client
 * error-handling logic unnecessarily defensive and fragile. New endpoints
 * should call `sendError(res, status, code, message, details?)` to emit a
 * single consistent JSON envelope. Existing endpoints can migrate opportunistically.
 *
 * Response shape:
 *   {
 *     "error": {
 *       "code": "VOTE_RATE_LIMITED",
 *       "message": "Human readable sentence."
 *     },
 *     "details"?: { ... }   // optional, for field-level validation issues
 *   }
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
  details?: unknown;
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorResponse = { error: { code, message } };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

/**
 * Sugar for the two most common cases.
 */
export const sendBadRequest = (res: Response, message: string, details?: unknown) =>
  sendError(res, 400, "BAD_REQUEST", message, details);

export const sendUnauthorized = (res: Response, message = "Not authenticated") =>
  sendError(res, 401, "UNAUTHORIZED", message);

export const sendForbidden = (res: Response, message = "Not allowed") =>
  sendError(res, 403, "FORBIDDEN", message);

export const sendNotFound = (res: Response, message = "Not found") =>
  sendError(res, 404, "NOT_FOUND", message);

export const sendConflict = (res: Response, code: string, message: string, details?: unknown) =>
  sendError(res, 409, code, message, details);

export const sendInternal = (res: Response, message = "Internal server error") =>
  sendError(res, 500, "INTERNAL_ERROR", message);

/**
 * Convert a Zod validation error into a standardized 400 response.
 * Uses the first field error as the message (readable) and includes the
 * full issue list as `details` for programmatic handling on the client.
 */
export function sendZodError(res: Response, err: ZodError): Response {
  const first = err.issues[0];
  const path = first?.path?.join(".") || "input";
  const message = first ? `${path}: ${first.message}` : "Invalid request";
  return sendError(res, 400, "VALIDATION_ERROR", message, { issues: err.issues });
}
