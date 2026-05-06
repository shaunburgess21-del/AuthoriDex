// Phase 4 — per-IP secondary rate limit on anonymous vote-write attempts.
//
// Defence-in-depth above the per-fdx_sid budget (server/lib/anonBudget.ts).
// The per-fdx_sid budget can be reset trivially by clearing cookies or
// opening a fresh incognito session, so a determined abuser could
// theoretically open dozens of windows from one machine. This middleware
// caps anonymous vote attempts from any single IP at
// ANON_VOTE_IP_DAILY_CAP (default 40) per 24h sliding window — generous
// for a household of multiple genuine users sharing Wi-Fi, strict enough
// to make scripted incognito-cycle abuse meaningless.
//
// Authenticated traffic (req.userId set) is skipped — logged-in users are
// gated only by the existing per-userId checkVoteRateLimit at
// routes.ts:778. This middleware is also the secondary defence during
// anonBudget.ts fail-open windows: if the DB is wedged and the budget
// can't enforce, the IP cap still does.
//
// Mounted per-route in Stage 4 on the 5 anonymous-eligible vote-write
// endpoints (after optionalAuth, before the handler body). Not a global
// /api/* middleware — non-vote endpoints shouldn't count against the
// cap, and per-route mounting also keeps the 429 response a feature of
// vote endpoints specifically.
//
// Correctness assumption: req.ip resolves to the genuine client IP, not
// the load-balancer or proxy IP. This requires app.set('trust proxy', ...)
// to be configured upstream — verify in Stage 8 manual testing by sending
// requests from two distinct origins and confirming each maintains its
// own counter. Misconfiguration symptom: the cap fires globally for all
// anonymous traffic instead of per-IP.
//
// Algorithm mirrors the existing voteRateLimit (server/routes.ts:778):
// in-memory Map<ip, number[]> of recent timestamps, filtered against
// the window on each check, with a periodic setInterval sweep to evict
// idle keys. Single-process state — fine for the current single-node
// deploy; if/when we go multi-node this should move to Redis (track
// in v2 follow-ups). Matches the locality assumptions of the existing
// rate limiters in this codebase.

import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "../auth-middleware";
import { ANON_VOTE_IP_DAILY_CAP } from "../lib/rankingConfig";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const ipAttemptMap = new Map<string, number[]>();

export function anonVoteIpRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if ((req as AuthRequest).userId) return next();

  const ip = req.ip;
  if (!ip) return next();

  const now = Date.now();
  const timestamps = ipAttemptMap.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= ANON_VOTE_IP_DAILY_CAP) {
    ipAttemptMap.set(ip, recent);
    const logCtx = {
      ip,
      count: recent.length,
      capHit: true,
      surface: "anonVoteIpRateLimit",
    };
    const logMsg = "anonymous vote IP cap exceeded";
    if (req.log) {
      req.log.warn(logCtx, logMsg);
    } else {
      console.warn(`[anonRateLimit] ${logMsg}`, logCtx);
    }
    res.status(429).json({
      error: "ip_rate_limit_exceeded",
      message: "Too many anonymous votes from this IP. Try again later.",
    });
    return;
  }

  recent.push(now);
  ipAttemptMap.set(ip, recent);
  next();
}

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, ts] of Array.from(ipAttemptMap.entries())) {
    const filtered = ts.filter((t) => t > cutoff);
    if (filtered.length === 0) ipAttemptMap.delete(ip);
    else ipAttemptMap.set(ip, filtered);
  }
}, SWEEP_INTERVAL_MS);
