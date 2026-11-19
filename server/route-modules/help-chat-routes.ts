import type { Express, Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { optionalAuth, type AuthRequest } from "../auth-middleware";
import { handleHelpChat } from "../help/handle-help-chat";

function helpChatKey(req: Request): string {
  const userId = (req as AuthRequest).userId;
  if (userId) return `help:${userId}`;
  return `help:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

const helpChatBurstLimiter = rateLimit({
  windowMs: 60_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: helpChatKey,
  message: { error: "Too many questions. Give it a minute and try again." },
});

/** Keeps one person or script from spending the shared daily budget. */
const helpChatDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: helpChatKey,
  message: {
    error: "You've reached today's question limit. The How it works page covers the same topics.",
  },
});

/** Public site guide. Optional auth so signed-in members get their own rate-limit bucket. */
export function registerHelpChatRoutes(app: Express): void {
  app.post(
    "/api/help/chat",
    optionalAuth,
    helpChatBurstLimiter,
    helpChatDailyLimiter,
    (req, res) => {
      void handleHelpChat(req as AuthRequest, res);
    },
  );
}
