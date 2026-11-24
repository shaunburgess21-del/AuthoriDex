import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Client key for the share-click IP rate limiter and the dedup hash.
 *
 * Uses Express `req.ip`. `trust proxy` is 1 (`server/index.ts`), so
 * that value is the address the trusted proxy actually connected from.
 * The first `X-Forwarded-For` hop is chosen by the caller and is not
 * a usable identity.
 */
export function shareClickClientKey(req: Pick<Request, "ip">): string {
  const ip = typeof req.ip === "string" ? req.ip.trim() : "";
  if (!ip) return "unknown";
  return ipKeyGenerator(ip);
}
