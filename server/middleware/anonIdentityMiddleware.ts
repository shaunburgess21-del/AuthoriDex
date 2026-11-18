// Phase 4 — ensure every /api/* request has an fdx_sid.
//
// Runs ahead of optionalAuth and the anonymous-vote budget logic so
// they can assume the id exists without minting it themselves.
// Idempotent — when the cookie or native X-Fdx-Sid header is already
// present, ensureFdxSid reuses it. Native responses echo the id in
// X-Fdx-Sid (the WebView drops the third-party cookie). Web responses
// stay cookie-only.
//
// Wrapped in try/catch so a cookie-set failure (e.g. malformed upstream
// proxy headers) never breaks an /api/ request — downstream code will
// simply fall back to its existing IP+UA defence-in-depth path. Matches
// the best-effort pattern used by the global auth-resolution middleware
// in server/index.ts.

import type { Request, Response, NextFunction } from "express";
import { ensureFdxSid } from "../lib/anonIdentity";

export function anonIdentityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    ensureFdxSid(req, res);
  } catch {
    /* best-effort — never block an API request on cookie minting */
  }
  next();
}
