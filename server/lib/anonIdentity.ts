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
// Browser flags: httpOnly, sameSite: 'lax', secure-in-production, path: '/', 1y max age.
// Native WebView origins use SameSite=None; Secure via authCookieFlags.
//
// The native document origin (capacitor://localhost or https://localhost)
// is a different site from https://voxdex.com, and iOS blocks that
// third-party cookie. Native responses also carry the same id in
// `X-Fdx-Sid` (see FDX_SID_HEADER). `readFdxSid` accepts that request
// header only for native origins, and only when it is a strict UUID.
// Web traffic never reads or emits the header.

import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { FDX_SID_HEADER, normalizeFdxSid } from "@shared/lib/fdxSid";

export { FDX_SID_HEADER };

export const FDX_SID_COOKIE = "fdx_sid";

export const NATIVE_CORS_ALLOW_HEADERS =
  "Authorization, Content-Type, Idempotency-Key, Accept, X-Fdx-Sid";

export const NATIVE_CORS_EXPOSE_HEADERS = FDX_SID_HEADER;

/** WebView origins for the Capacitor iOS (`capacitor://`) and Android (`https://`) apps. */
const NATIVE_APP_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);

export function isNativeAppOrigin(req: Request): boolean {
  const origin = req.get("origin");
  return origin != null && NATIVE_APP_ORIGINS.has(origin);
}

/**
 * Browser traffic keeps `SameSite=Lax`. The native WebView is a different
 * origin from https://voxdex.com, so those responses need `SameSite=None`
 * (which requires `Secure`) or the anonymous `fdx_sid` cookie is dropped.
 */
export function authCookieFlags(req: Request): {
  httpOnly: true;
  sameSite: "lax" | "none";
  secure: boolean;
  path: "/";
} {
  if (isNativeAppOrigin(req)) {
    return { httpOnly: true, sameSite: "none", secure: true, path: "/" };
  }
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/**
 * Cookie max-age in **seconds** (Express `res.cookie({ maxAge })` wants
 * milliseconds — multiply at the call site). Stored in seconds so the
 * value reads the same as a `Set-Cookie: Max-Age=…` header attribute.
 */
export const FDX_SID_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Read the anonymous id, generating + setting one if missing.
 * Idempotent: if a valid cookie or (native-only) `X-Fdx-Sid` header
 * already exists, that id is returned and no new UUID is minted.
 *
 * The cookie "valid" check is `length > 8` to match `getSessionId` —
 * guards against truncated cookie values without a full UUID check.
 * The request header is stricter: `normalizeFdxSid` only.
 *
 * Native responses always echo the resolved id in `X-Fdx-Sid` and are
 * marked uncacheable so a shared cache cannot replay one device's id.
 * Web responses do not gain that header.
 */
export function ensureFdxSid(req: Request, res: Response): string {
  const fromCookie = readCookieFdxSid(req);
  const existing = fromCookie || readNativeFdxSidHeader(req);
  if (existing) {
    if (!fromCookie) {
      res.cookie(FDX_SID_COOKIE, existing, {
        ...authCookieFlags(req),
        maxAge: FDX_SID_MAX_AGE * 1000,
      });
    }
    exposeNativeFdxSid(req, res, existing);
    return existing;
  }

  const fresh = randomUUID();
  res.cookie(FDX_SID_COOKIE, fresh, {
    ...authCookieFlags(req),
    maxAge: FDX_SID_MAX_AGE * 1000,
  });
  exposeNativeFdxSid(req, res, fresh);
  return fresh;
}

/**
 * Pure-read variant — cookie first, then a native `X-Fdx-Sid` header.
 * Does not mint. `optionalAuth` builds `anon_<sid>` from this, and the
 * signup migration re-points that same id onto the new account.
 */
export function readFdxSid(req: Request): string {
  return readCookieFdxSid(req) || readNativeFdxSidHeader(req);
}

function readCookieFdxSid(req: Request): string {
  const header = req.headers.cookie || "";
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${FDX_SID_COOKIE}=([^;]+)`),
  );
  if (match && match[1] && match[1].length > 8) return match[1];
  return "";
}

function readNativeFdxSidHeader(req: Request): string {
  if (!isNativeAppOrigin(req)) return "";
  return normalizeFdxSid(req.get(FDX_SID_HEADER));
}

/**
 * Echo the id to the native WebView. Hook `write` and `end` so a later
 * route-level `Cache-Control` cannot leave this per-device value on a
 * shared cache entry. The value is never logged.
 */
function exposeNativeFdxSid(req: Request, res: Response, sid: string): void {
  if (!isNativeAppOrigin(req)) return;
  const exposed = normalizeFdxSid(sid);
  if (!exposed) return;

  const apply = () => {
    if (res.headersSent) return;
    res.setHeader(FDX_SID_HEADER, exposed);
    res.setHeader("Cache-Control", "private, no-store");
  };
  apply();

  if (res.locals.fdxSidHeaderApplied === true) return;
  res.locals.fdxSidHeaderApplied = true;

  const originalEnd = res.end.bind(res);
  res.end = function endWithFdxSid(this: Response, ...args: Parameters<Response["end"]>) {
    apply();
    return originalEnd(...args);
  } as Response["end"];

  const originalWrite = res.write.bind(res);
  res.write = function writeWithFdxSid(this: Response, ...args: Parameters<Response["write"]>) {
    apply();
    return originalWrite(...args);
  } as Response["write"];
}

/** Credentialed CORS for the Capacitor WebView, including the anon-id header. */
export function applyNativeCorsHeaders(res: Response, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Headers", NATIVE_CORS_ALLOW_HEADERS);
  res.setHeader("Access-Control-Expose-Headers", NATIVE_CORS_EXPOSE_HEADERS);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
}
