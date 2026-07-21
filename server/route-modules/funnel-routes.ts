import type { Express } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { optionalAuth, type AuthRequest } from "../auth-middleware";
import { db } from "../db";
import { funnelEvents } from "@shared/schema";
import { readFdxSid } from "../lib/anonIdentity";

/**
 * Product funnel telemetry (first-visit onboarding, Quick Vote overlay,
 * signup attribution). Anon-friendly: identity comes from the fdx_sid
 * cookie minted by anonIdentityMiddleware, plus userId when authed.
 * Fire-and-forget from the client — failures must never affect UX.
 */

const funnelEventSchema = z.object({
  eventType: z.string().min(1).max(64),
  surface: z.string().min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
});

const funnelEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

export function registerFunnelRoutes(app: Express): void {
  app.post("/api/funnel/event", funnelEventLimiter, optionalAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = funnelEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid event payload" });
      }
      await db.insert(funnelEvents).values({
        eventType: parsed.data.eventType,
        surface: parsed.data.surface,
        fdxSid: readFdxSid(req) || null,
        userId: req.userId ?? null,
        metadata: parsed.data.metadata ?? {},
      });
      res.status(204).send();
    } catch (error) {
      console.error("[funnel] event", error);
      res.status(500).json({ error: "Failed to record event" });
    }
  });
}
