import type { Express, Request } from "express";
import crypto from "crypto";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "../db";
import { profiles, shareClicks, creditLedger } from "@shared/schema";
import { gamificationService } from "../services/gamification";
import { checkAndAwardShareMasterBadge } from "../services/badges";
import { requireAuth, requireAdmin, type AuthRequest } from "../auth-middleware";
import { generateUniqueReferralCode } from "../utils/referral-code";

/**
 * Hosts that count as "internal" for share-click attribution.
 *
 * If the inbound HTTP Referer matches any of these (host or
 * suffix-of-host), we reject the click — the sharer didn't drive an
 * external visit; the user just clicked a link inside the app.
 *
 * Stays in lockstep with INTERNAL_REFERRER_HOSTS in routes.ts (the
 * admin-side aggregator). Adding a host here without adding it
 * there will let the attributed click land but still show the
 * sharer's own domain in the admin top-domains aggregator.
 */
const INTERNAL_HOSTS = [
  "voxdex.com",
  "www.voxdex.com",
  "staging.voxdex.com",
  "dev.voxdex.com",
  "localhost",
  "127.0.0.1",
];

/**
 * Strict external-referer check. Returns true ONLY when the header
 * is present, parseable as a URL, and the host is not one of our
 * own properties (or a subdomain thereof).
 *
 * Inverted vs. the prior `isInternalReferrer` helper: missing or
 * malformed Referer headers used to fall through to the credit
 * path because the policy was "reject if internal" and `null`
 * doesn't match any internal host. That let unauthenticated
 * scripts farm credits by simply omitting the header (or sending
 * `referrerPolicy: "no-referrer"`). The credit-side daily cap of
 * 3/day was the only line of defence — trivial to clear from a
 * botnet rotating IPs.
 *
 * Now: the credit path requires a *positive* attribution to an
 * external origin. Every other shape (no header, "" header, junk
 * URL, our own host) drops to credited=false.
 */
function isExternalReferrer(referer: string | null | undefined): boolean {
  if (typeof referer !== "string" || referer.length === 0) return false;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  const isInternal = INTERNAL_HOSTS.some(
    (internal) => host === internal || host.endsWith(`.${internal}`),
  );
  return !isInternal;
}

function hashIp(rawIp: string): string {
  return crypto.createHash("sha256").update(rawIp).digest("hex");
}

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

/** IPv6-safe client key shared by rate limiter and dedup ipHash. */
function clientIdentityKey(req: Request): string {
  const ip = clientIp(req);
  if (ip === "unknown") return "unknown";
  return ipKeyGenerator(ip);
}

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().split("T")[0];
}

// Per-IP rate limit on the public track-click endpoint. The
// share_click credit row is daily-capped at 3/day per sharer, but
// that cap protects the *credit ledger*, not the share_clicks
// analytics table — without an IP cap a botnet can write millions
// of credited=false rows and bloat analytics. 60/hr/IP is plenty
// for any legitimate sharer-driven traffic spike.
const trackClickLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientIdentityKey,
});

// Length caps. The DB columns are unbounded text; without these
// caps an attacker can stuff arbitrary payloads into
// share_clicks.share_url / share_surface (which then fan out to
// the credit_ledger metadata blob). The numbers below match what
// the legitimate client surfaces actually emit:
//   surface — short keys like "leaderboard_card", "predict_market"
//   shareUrl — full app URLs incl. ?ref query strings
const MAX_SURFACE_LEN = 50;
const MAX_SHARE_URL_LEN = 2048;

export function registerShareRoutes(app: Express): void {
  // POST /api/share/track-click — records an external click on a
  // tracked share link and (when valid + uncapped) awards
  // share_click credits to the sharer.
  //
  // Validation order:
  //   1. Per-IP rate limit (60/hr) via trackClickLimiter middleware
  //   2. Body shape + length caps on surface / shareUrl
  //   3. sharerUserId exists in profiles (silently 200 with
  //      credited=false if not — the link could legitimately
  //      outlive the account)
  //   4. Referer is external (parseable, present, not one of our
  //      hosts). Missing / malformed / internal still inserts the
  //      analytics row but skips the credit award.
  //   5. Dedup against (sharerUserId, ipHash, utcDate) — same
  //      household refreshing doesn't farm credits
  //
  // The credit award itself respects the daily cap configured on
  // the credit_actions row (default 3/day), so even a successful
  // dedup-pass can no-op once the user hits the cap.
  app.post("/api/share/track-click", trackClickLimiter, async (req, res) => {
    try {
      const { sharerUserId, surface, shareUrl } = req.body ?? {};

      if (
        typeof sharerUserId !== "string" ||
        !sharerUserId ||
        typeof surface !== "string" ||
        !surface ||
        typeof shareUrl !== "string" ||
        !shareUrl
      ) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (surface.length > MAX_SURFACE_LEN) {
        return res.status(400).json({ error: "surface_too_long" });
      }
      if (shareUrl.length > MAX_SHARE_URL_LEN) {
        return res.status(400).json({ error: "share_url_too_long" });
      }

      // 1) Profile existence guard. We never reveal whether a
      // userId exists via the response shape — silent no-op keeps
      // the endpoint useless for user-enumeration probes.
      const [sharer] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, sharerUserId))
        .limit(1);
      if (!sharer) {
        return res.json({ credited: false, creditsAwarded: 0 });
      }

      // 2) Referer guard. The credit path requires a positive
      // attribution to an external origin — missing, malformed, or
      // internal Referer headers all drop to credit-ineligible.
      // The analytics row is still written below so funnel reporting
      // sees the click; only the credit award is suppressed.
      const refererHeader =
        (req.headers["referer"] as string | undefined) ??
        (req.headers["referrer"] as string | undefined) ??
        null;
      const creditEligible = isExternalReferrer(refererHeader);

      // 3) Dedup by (sharer, ipHash, utcDate). Same household
      // refreshing the link doesn't farm credits. Dedup-hit still
      // exits early because we already have an analytics row for
      // this (sharer, ip, day) — no value in inserting another.
      const ipHash = hashIp(clientIdentityKey(req));
      const utcToday = utcDateString();
      const utcStart = new Date(`${utcToday}T00:00:00.000Z`);

      const existingToday = await db
        .select({ id: shareClicks.id })
        .from(shareClicks)
        .where(
          and(
            eq(shareClicks.sharerUserId, sharerUserId),
            eq(shareClicks.ipHash, ipHash),
            gte(shareClicks.clickedAt, utcStart),
          ),
        )
        .limit(1);
      if (existingToday.length > 0) {
        return res.json({ credited: false, creditsAwarded: 0 });
      }

      // Count today's prior clicks from THIS sharer (regardless of
      // ip) so the idempotency key encodes the slot index. The
      // daily cap is enforced separately inside adjustCredits().
      const [{ count: priorCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(shareClicks)
        .where(
          and(
            eq(shareClicks.sharerUserId, sharerUserId),
            gte(shareClicks.clickedAt, utcStart),
          ),
        );
      const slotIndex = Number(priorCount) + 1;
      const idempotencyKey = `share_click_${sharerUserId}_${utcToday}_${slotIndex}`;

      // Concurrent requests can both compute the same slotIndex
      // before either insert commits. The global UNIQUE on
      // `credit_idempotency_key` (shared/schema.ts) guarantees the
      // second insert fails with Postgres error code 23505. Catch
      // it and treat as already-tracked rather than 500-ing the
      // tracker — the credits side stays safe via adjustCredits()
      // which has its own duplicate handling.
      let inserted: { id: number } | undefined;
      try {
        const rows = await db
          .insert(shareClicks)
          .values({
            sharerUserId,
            shareSurface: surface,
            shareUrl,
            externalReferrer: refererHeader,
            ipHash,
            credited: false,
            creditIdempotencyKey: idempotencyKey,
          })
          .returning({ id: shareClicks.id });
        inserted = rows[0];
      } catch (insertErr: any) {
        if (insertErr?.code === "23505") {
          return res.json({ credited: false, creditsAwarded: 0 });
        }
        throw insertErr;
      }

      // Credit award is gated on `creditEligible` (positive external
      // Referer) and is otherwise best-effort. If adjustCredits fails
      // (cap, duplicate, inactive action) we keep the share_clicks
      // row — the admin tab uses these for funnel analytics
      // regardless of credit.
      let creditsAwarded = 0;
      let credited = false;
      if (creditEligible) {
        try {
          const result = await gamificationService.adjustCredits(
            sharerUserId,
            "share_click",
            idempotencyKey,
            { metadata: { surface, shareUrl, shareClickId: inserted?.id } },
          );
          if (result.awarded) {
            creditsAwarded = result.amount;
            credited = true;
            await db
              .update(shareClicks)
              .set({ credited: true })
              .where(eq(shareClicks.id, inserted!.id));

            // Share Master badge — fires on the first credited click
            // for this user. The badge service guards idempotency so
            // subsequent credited clicks are no-ops.
            try {
              await checkAndAwardShareMasterBadge(sharerUserId);
            } catch (badgeErr) {
              console.warn(
                "[share-track-click] share_master badge check failed",
                badgeErr,
              );
            }
          }
        } catch (err) {
          console.error("[share-track-click] credit award failed", err);
        }
      }

      return res.json({ credited, creditsAwarded });
    } catch (error: any) {
      console.error("[share-track-click] error", error?.message);
      return res.status(500).json({ error: "Failed to track share click" });
    }
  });

  // GET /api/me/referral-stats — feeds the "Refer a Friend" card on
  // /me. Returns the user's referral code (generating-on-demand for
  // pre-overhaul accounts is handled by /api/profile/sync, so by
  // the time this runs the column should be populated for every
  // active user) plus successful + pending referral counts.
  app.get("/api/me/referral-stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;

      // Read via raw SQL on the snake_case column directly. Earlier
      // attempts went through Drizzle's typed select on
      // `profiles.referralCode`; under some build / process-restart
      // sequences (notably when the dev server is running an older
      // compiled bundle than the schema file on disk) that mapping
      // resolved to undefined even when the column was populated,
      // which produced a stable referralCode=null in the response
      // and trapped the client card in its retry state. Going
      // through `sql<string>...` skips the codegen layer and reads
      // the column verbatim, so the only failure mode is "the row
      // doesn't exist" — which we handle below.
      const profileRows = await db.execute<{
        referral_code: string | null;
        exists: boolean;
      }>(sql`
        SELECT referral_code, true AS exists
        FROM profiles
        WHERE id = ${userId}
        LIMIT 1
      `);

      const profileRow =
        ((profileRows as any).rows ?? profileRows ?? [])[0] ?? null;

      let referralCode: string | null =
        (profileRow?.referral_code as string | null) ?? null;

      // Self-heal for accounts that pre-date the referral column
      // and never went through a fresh /api/profile/sync after the
      // overhaul. We mint a code on demand and persist it so the
      // next call short-circuits to the fast path. Best-effort: if
      // generation exhausts (extremely unlikely) we still return
      // the row with a null code rather than 500-ing — the client
      // is hardened to render a "generating" state in that case.
      if (profileRow && !referralCode) {
        try {
          const minted = await generateUniqueReferralCode();
          if (minted) {
            await db
              .update(profiles)
              .set({ referralCode: minted })
              .where(eq(profiles.id, userId));
            referralCode = minted;
          }
        } catch (err) {
          console.warn("[me-referral-stats] on-demand mint failed", err);
        }
      }

      const [{ count: successfulReferrals }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(profiles)
        .where(
          and(
            eq(profiles.referredBy, userId),
            isNotNull(profiles.firstActionAt),
          ),
        );

      // Pending = signed up via my code, but hasn't taken a
      // meaningful action yet. The /me UI shows this so the user
      // knows their referral landed even before the credit fires.
      const [{ count: pendingReferrals }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(profiles)
        .where(
          and(
            eq(profiles.referredBy, userId),
            isNull(profiles.firstActionAt),
          ),
        );

      res.json({
        referralCode,
        successfulReferrals: Number(successfulReferrals) || 0,
        pendingReferrals: Number(pendingReferrals) || 0,
      });
    } catch (error: any) {
      console.error("[me-referral-stats] error", error?.message);
      res.status(500).json({ error: "Failed to load referral stats" });
    }
  });

  // GET /api/admin/referrals — admin Referrals tab. Returns up to
  // 500 most-recent referee profiles together with their referrer
  // username and (if any) the credit_ledger row that paid the
  // referrer. We do the join in two passes rather than a self-join
  // on profiles because Drizzle's table-alias support is awkward
  // and the row count here is bounded (LIMIT 500) — N+1 cost is
  // dwarfed by the network round-trip.
  app.get("/api/admin/referrals", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const referees = await db
        .select({
          id: profiles.id,
          username: profiles.username,
          createdAt: profiles.createdAt,
          firstActionAt: profiles.firstActionAt,
          referrerId: profiles.referredBy,
        })
        .from(profiles)
        .where(isNotNull(profiles.referredBy))
        .orderBy(sql`${profiles.createdAt} DESC NULLS LAST`)
        .limit(500);

      if (referees.length === 0) return res.json([]);

      const referrerIds = Array.from(
        new Set(referees.map((r) => r.referrerId).filter((id): id is string => Boolean(id))),
      );

      const referrerRows = referrerIds.length
        ? await db
            .select({ id: profiles.id, username: profiles.username })
            .from(profiles)
            .where(sql`${profiles.id} = ANY(${referrerIds})`)
        : [];
      const referrerMap = new Map(referrerRows.map((r) => [r.id, r.username]));

      // Pull the matching referral_completed ledger rows in one
      // shot. The idempotency key is `referral_${referee.id}` so we
      // can map by extracting the suffix.
      const refereeIds = referees.map((r) => r.id);
      const ledgerKeys = refereeIds.map((id) => `referral_${id}`);
      const ledgerRows = ledgerKeys.length
        ? await db
            .select({
              idempotencyKey: creditLedger.idempotencyKey,
              amount: creditLedger.amount,
              createdAt: creditLedger.createdAt,
            })
            .from(creditLedger)
            .where(
              and(
                eq(creditLedger.txnType, "referral_completed"),
                sql`${creditLedger.idempotencyKey} = ANY(${ledgerKeys})`,
              ),
            )
        : [];
      const ledgerMap = new Map(
        ledgerRows.map((row) => [row.idempotencyKey, row]),
      );

      const normalised = referees.map((r) => {
        const ledger = ledgerMap.get(`referral_${r.id}`);
        return {
          refereeId: r.id,
          refereeUsername: r.username,
          refereeCreatedAt: r.createdAt,
          refereeFirstActionAt: r.firstActionAt,
          referrerId: r.referrerId,
          referrerUsername: r.referrerId ? referrerMap.get(r.referrerId) ?? null : null,
          creditAmount: ledger?.amount ?? null,
          creditAwardedAt: ledger?.createdAt ?? null,
        };
      });

      res.json(normalised);
    } catch (error: any) {
      console.error("[admin-referrals] error", error?.message);
      res.status(500).json({ error: "Failed to load referrals" });
    }
  });
}
