import type { Express, Request } from "express";
import crypto from "crypto";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
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

function isInternalReferrer(referer: string | null): boolean {
  if (!referer) return false;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return INTERNAL_HOSTS.some(
      (internal) => host === internal || host.endsWith(`.${internal}`),
    );
  } catch {
    // Malformed Referer header — treat as external; the credit
    // award is daily-capped + dedup-keyed, so a bad actor can't
    // farm credits by injecting garbage values.
    return false;
  }
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

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().split("T")[0];
}

export function registerShareRoutes(app: Express): void {
  // POST /api/share/track-click — records an external click on a
  // tracked share link and (when valid + uncapped) awards
  // share_click credits to the sharer.
  //
  // Validation order:
  //   1. sharerUserId exists in profiles (silently 200 with
  //      credited=false if not — the link could legitimately
  //      outlive the account)
  //   2. Referer is external (else 200 credited=false; this is the
  //      noisy case — a user clicking their own link inside the app)
  //   3. Dedup against (sharerUserId, ipHash, utcDate) — same
  //      household refreshing doesn't farm credits
  //
  // The credit award itself respects the daily cap configured on
  // the credit_actions row (default 3/day), so even a successful
  // dedup-pass can no-op once the user hits the cap.
  app.post("/api/share/track-click", async (req, res) => {
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

      // 2) Referer guard. The whole point of share_click is to
      // reward *external* arrivals; an in-app click is just
      // navigation noise.
      const refererHeader =
        (req.headers["referer"] as string | undefined) ??
        (req.headers["referrer"] as string | undefined) ??
        null;
      if (isInternalReferrer(refererHeader ?? null)) {
        return res.json({ credited: false, creditsAwarded: 0 });
      }

      // 3) Dedup by (sharer, ipHash, utcDate). Same household
      // refreshing the link doesn't farm credits.
      const ipHash = hashIp(clientIp(req));
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

      const [inserted] = await db
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

      // Credit award is best-effort. If it fails (cap, duplicate,
      // inactive action) we keep the share_clicks row — the admin
      // tab uses these for funnel analytics regardless of credit.
      let creditsAwarded = 0;
      let credited = false;
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
