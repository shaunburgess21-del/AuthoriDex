// Phase 4 — anonymous-identity cookie (`fdx_sid`).
//
// Single source of truth for reading and minting the long-lived
// anonymous-identity UUID cookie. The cookie is set on first visit to
// any /api/* endpoint by server/middleware/anonIdentityMiddleware.ts so
// that every anonymous user has a stable identifier regardless of which
// surface they touch first — the legacy fdx_sid sites in routes.ts
// (page-view middleware at ~938 and trending-detail handler at ~1316)
// only set it on those specific paths and so missed any user who never
// hit them.
//
// The cookie is read manually from `req.headers.cookie` because the
// project does not use the `cookie-parser` middleware (matching the
// existing `getSessionId` helper at server/routes.ts:540–545). Adding
// cookie-parser would be a one-line dep but the manual parse is fine
// and keeps the surface area small.
//
// Flags mirror the two existing fdx_sid set sites verbatim:
//   httpOnly, sameSite: 'lax', secure-in-production, path: '/', 1y max age.

import type { Request, Response } from "express";
import { randomUUID } from "crypto";

export const FDX_SID_COOKIE = "fdx_sid";

/**
 * Cookie max-age in **seconds** (Express `res.cookie({ maxAge })` wants
 * milliseconds — multiply at the call site). Stored in seconds so the
 * value reads the same as a `Set-Cookie: Max-Age=…` header attribute.
 */
export const FDX_SID_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Read the fdx_sid cookie from the request, generating + setting one if
 * missing. Idempotent: if a valid cookie already exists, the existing
 * UUID is returned and no Set-Cookie header is emitted.
 *
 * The "valid" check is `length > 8` to match the existing `getSessionId`
 * heuristic at routes.ts:540–545 — guards against truncated or otherwise
 * malformed cookie values without a full UUID-format check.
 */
export function ensureFdxSid(req: Request, res: Response): string {
  const existing = readFdxSid(req);
  if (existing) return existing;

  const fresh = randomUUID();
  res.cookie(FDX_SID_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FDX_SID_MAX_AGE * 1000,
  });
  return fresh;
}

/**
 * Pure-read variant — returns the existing cookie value or `''`. Used
 * by `optionalAuth` (which only needs to read, never mint, since the
 * middleware already ran ahead of it).
 */
export function readFdxSid(req: Request): string {
  const header = req.headers.cookie || "";
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${FDX_SID_COOKIE}=([^;]+)`),
  );
  if (match && match[1] && match[1].length > 8) return match[1];
  return "";
}
