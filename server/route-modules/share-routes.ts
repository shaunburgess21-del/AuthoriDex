import type { Express } from "express";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "../db";
import { profiles, shareClicks, creditLedger } from "@shared/schema";
import { gamificationService } from "../services/gamification";
import { checkAndAwardShareMasterBadge } from "../services/badges";
import { requireAuth, requireAdmin, type AuthRequest } from "../auth-middleware";
import { generateUniqueReferralCode } from "../utils/referral-code";
import { trackShareClick, type ShareClickInsert } from "../services/share-click-track";
import { shareClickClientKey } from "../services/share-click-client-key";

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
  // Passed by reference so express-rate-limit can see `ipKeyGenerator`
  // inside shareClickClientKey. That function reads req.ip only.
  keyGenerator: shareClickClientKey,
});

export function registerShareRoutes(app: Express): void {
  // POST /api/share/track-click — records an external click on a
  // tracked share link and (when valid + uncapped) awards
  // share_click credits to the sharer.
  //
  // Identity is either `referralCode` (links shared after the UUID
  // was removed from the query string) or legacy `sharerUserId`
  // (links already in circulation). Resolution happens before the
  // referrer, dedup, and credit path.
  //
  // Validation order:
  //   1. Per-IP rate limit (60/hr) via trackClickLimiter, keyed on
  //      req.ip (trust proxy), not the caller-supplied XFF hop
  //   2. Body shape + length caps on surface / shareUrl
  //   3. Resolve referralCode, or legacy sharerUserId until the
  //      sunset instant, to a profile (silently 200 with
  //      credited=false if not). An authenticated caller who is
  //      that profile is not credited.
  //   4. Dedup against (sharerUserId, ipHash, utcDate)
  //   5. Per-sharer request budget (30/hr) before insert
  //   6. Referrer is external. The body `referrer` (document.referrer
  //      captured at landing) wins when present; otherwise the
  //      Referer header. That value is advisory. Missing / malformed
  //      / internal still inserts the analytics row but skips the
  //      credit award. The daily cap and the dedup limit the money.
  //
  // The credit award itself respects the daily cap configured on
  // the credit_actions row (default 3/day), so even a successful
  // dedup-pass can no-op once the user hits the cap.
  app.post("/api/share/track-click", trackClickLimiter, async (req: AuthRequest, res) => {
    try {
      const refererHeader =
        (req.headers["referer"] as string | undefined) ??
        (req.headers["referrer"] as string | undefined) ??
        null;
      const result = await trackShareClick(
        {
          body: req.body ?? {},
          referer: refererHeader,
          ipKey: shareClickClientKey(req),
          callerUserId: req.userId ?? null,
        },
        {
          findProfileById: async (id) => {
            const [row] = await db
              .select({ id: profiles.id })
              .from(profiles)
              .where(eq(profiles.id, id))
              .limit(1);
            return row ?? null;
          },
          findProfileByReferralCode: async (code) => {
            const [row] = await db
              .select({ id: profiles.id })
              .from(profiles)
              .where(eq(profiles.referralCode, code))
              .limit(1);
            return row ?? null;
          },
          findExistingToday: async (sharerUserId, ipHash, utcStart) => {
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
            return existingToday.length > 0;
          },
          countToday: async (sharerUserId, utcStart) => {
            const [{ count: priorCount }] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(shareClicks)
              .where(
                and(
                  eq(shareClicks.sharerUserId, sharerUserId),
                  gte(shareClicks.clickedAt, utcStart),
                ),
              );
            return Number(priorCount) || 0;
          },
          insertClick: async (row: ShareClickInsert) => {
            try {
              const rows = await db
                .insert(shareClicks)
                .values(row)
                .returning({ id: shareClicks.id });
              const inserted = rows[0];
              if (!inserted) return "duplicate";
              return inserted;
            } catch (insertErr: any) {
              // Concurrent requests can both compute the same slot
              // index. The UNIQUE on credit_idempotency_key (23505)
              // means the second insert is already tracked.
              if (insertErr?.code === "23505") return "duplicate";
              throw insertErr;
            }
          },
          markCredited: async (id) => {
            await db
              .update(shareClicks)
              .set({ credited: true })
              .where(eq(shareClicks.id, id));
          },
          adjustCredits: async (userId, actionKey, idempotencyKey, metadata) => {
            const awarded = await gamificationService.adjustCredits(
              userId,
              actionKey,
              idempotencyKey,
              {
                metadata: {
                  surface: metadata.surface,
                  shareUrl: metadata.shareUrl,
                  shareClickId: metadata.shareClickId,
                },
              },
            );
            return { awarded: awarded.awarded, amount: awarded.amount, reason: awarded.reason };
          },
          awardShareMaster: (userId) => checkAndAwardShareMasterBadge(userId),
        },
      );
      return res.status(result.status).json(result.body);
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
