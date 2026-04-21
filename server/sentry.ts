import * as Sentry from "@sentry/node";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "./log";

/**
 * Initialize Sentry based on env vars. Zero-cost if SENTRY_DSN isn't set —
 * Sentry stays uninitialized and the helpers below become no-ops.
 *
 * Env:
 *   SENTRY_DSN              — if set, Sentry is enabled
 *   SENTRY_ENVIRONMENT      — defaults to NODE_ENV
 *   SENTRY_TRACES_SAMPLE_RATE — defaults to 0 (no perf traces; errors only)
 *   SENTRY_RELEASE          — optional deploy/version tag
 */
export function initSentry(): boolean {
  const dsn = (process.env.SENTRY_DSN ?? "").trim();
  if (!dsn) {
    logger.debug("[Sentry] SENTRY_DSN not set — Sentry disabled.");
    return false;
  }

  const tracesSampleRate = Number.parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"
  );

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    // Don't send local PII by default; surface it explicitly in captureContext.
    sendDefaultPii: false,
  });

  logger.info({ environment: process.env.NODE_ENV }, "[Sentry] Initialized");
  return true;
}

/**
 * Express error handler that reports unhandled errors to Sentry (when enabled)
 * and forwards to the next handler. Mount this late in the chain — after
 * routes but before the final JSON error responder.
 */
export function sentryErrorHandler(
  err: unknown,
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const dsnConfigured = !!(process.env.SENTRY_DSN && process.env.SENTRY_DSN.trim());
  if (dsnConfigured) {
    Sentry.withScope((scope) => {
      if (req.id) scope.setTag("requestId", req.id);
      const authReq = req as Request & { userId?: string; userRole?: string };
      if (authReq.userId) scope.setUser({ id: authReq.userId });
      if (authReq.userRole) scope.setTag("userRole", authReq.userRole);
      scope.setTag("path", req.path);
      scope.setTag("method", req.method);
      Sentry.captureException(err);
    });
  }
  next(err);
}

/**
 * Capture a background (non-request) exception. Safe to call whether or not
 * Sentry is initialized.
 */
export function captureBackgroundError(err: unknown, context?: Record<string, unknown>) {
  const dsnConfigured = !!(process.env.SENTRY_DSN && process.env.SENTRY_DSN.trim());
  if (!dsnConfigured) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err);
  });
}

/**
 * Mount Sentry's request handler. Call BEFORE any routes so all incoming
 * requests are tagged correctly. No-op when Sentry is disabled.
 */
export function mountSentryRequestHandler(_app: Express) {
  // Note: @sentry/node v8+ auto-instruments via `Sentry.init` above; there's
  // no separate `requestHandler` middleware like there was in v7. The
  // dedicated error handler below is still needed for explicit capture with
  // our custom tags (requestId, userId). This function is kept as a stable
  // integration point for possible future hooks (e.g. breadcrumbs).
}
