import pino, { type Logger } from "pino";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Structured logger ──────────────────────────────────────────────────────
// We use pino instead of raw console.log for three reasons:
//   1. JSON output is trivially ingestible by Datadog / Grafana Loki / CloudWatch.
//   2. Child loggers let us attach a per-request `requestId` (and `userId` once
//      auth resolves) so log lines from the same request are easy to correlate.
//   3. Log levels (trace/debug/info/warn/error/fatal) actually mean something
//      — ops can filter noise without regex.
//
// Env knobs:
//   LOG_LEVEL   — default "info" in prod, "debug" in dev
//   LOG_PRETTY  — "true" renders human-friendly lines via `pino-pretty` (dev only)

const IS_PROD = process.env.NODE_ENV === "production";
const LEVEL = (process.env.LOG_LEVEL ?? (IS_PROD ? "info" : "debug")).toLowerCase();
const PRETTY = (process.env.LOG_PRETTY ?? "").toLowerCase() === "true" && !IS_PROD;

export const logger: Logger = pino({
  level: LEVEL,
  // Redact secrets in case they ever end up on a log object by accident.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[REDACTED]",
  },
  ...(PRETTY
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        },
      }
    : {}),
});

// ─── Request ID middleware ──────────────────────────────────────────────────
// Attaches a stable `requestId` to every request (using the client-supplied
// `x-request-id` header if present, otherwise generating a UUID). The ID is
// echoed back to the client for tail-through-the-stack debugging, and a child
// logger is hung off the request so downstream handlers can log with context:
//
//   req.log.info({ personId }, "Resolved person");
//   → {"level":30,"requestId":"abc-123","personId":"p1","msg":"Resolved person"}

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
    log?: Logger;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const id = (typeof incoming === "string" && incoming.length > 0 && incoming.length < 128)
    ? incoming
    : crypto.randomUUID();
  req.id = id;
  req.log = logger.child({ requestId: id });
  res.setHeader("x-request-id", id);
  next();
}

// ─── Back-compat shim ───────────────────────────────────────────────────────
// Preserves the `log(msg, source?)` API that existed before pino. New call
// sites should prefer `logger.info(...)` / `req.log?.info(...)` directly.
export function log(message: string, source = "express") {
  logger.info({ source }, message);
}
