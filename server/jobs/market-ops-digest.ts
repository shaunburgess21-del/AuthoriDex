/**
 * Daily World Market operations digest.
 *
 * Read-only reporting job. Surfaces the markets that need an operator's
 * attention and pushes them to the configured ops channel (email today,
 * Discord/Slack later) via the channel-agnostic dispatcher. Touches no
 * market state — it only reads and reports.
 *
 * Buckets (community / World Markets only):
 *   - Resolves within 48h : status OPEN, endAt in the next 48h
 *   - Needs resolution     : status CLOSED_PENDING (awaiting a manual winner)
 *   - Stuck                : CLOSED_PENDING whose endAt was >24h ago
 *   - Drafts to review     : unpublished scout output, flagged by health and
 *                            by how long it has left before auto-expiry
 *
 * Also exports `sendMarketNeedsResolutionAlert()` — the instant ping fired
 * by the resolver cron the moment a market flips to CLOSED_PENDING.
 *
 * Scheduling: once daily (see server/index.ts) + external cron fallback
 * (POST /api/cron/market-ops-digest). Advisory-locked so multi-instance
 * Railway deployments don't double-send.
 */

import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db, withDbAdvisoryLock } from "../db";
import { marketBets, predictionMarkets } from "@shared/schema";
import { log } from "../log";
import {
  adminResolveMarketUrl,
  adminWorldMarketsUrl,
  getAdminBaseUrl,
  sendOpsAlert,
  type OpsAlert,
  type OpsAlertItem,
  type OpsAlertSection,
} from "../services/ops-alerts";
import {
  runResolutionScout,
  type ScoutAction,
  type ScoutFinding,
  type ScoutStage,
} from "./resolution-scout";

const MARKET_OPS_DIGEST_LOCK_KEY = 5_210;

const CLOSING_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

interface DigestMarketRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  endAt: Date;
}

export interface MarketOpsDigestResult {
  closingSoon: number;
  needsResolution: number;
  stuck: number;
  scoutFindings: number;
  scoutResolveNow: number;
  /** Unpublished drafts sitting in the review queue. */
  draftsAwaitingReview: number;
  /** Of those, drafts with no health flags — safe to publish as-is. */
  draftsReady: number;
  /** Drafts that will auto-void within the window unless reviewed. */
  draftsExpiringSoon: number;
  alert: { delivered: number; skipped: number; failed: number };
}

/**
 * Human-readable reason a draft shouldn't be published as-is. Mirrors the
 * copy in the admin edit modal so the email and the CMS agree.
 */
const DRAFT_HEALTH_LABEL: Record<string, string> = {
  already_expired: "past its resolution date",
  ends_soon: "resolves within 48h",
  schedule_drift: "source rescheduled",
  book_oversubscribed: "source odds over 100%",
  book_short: "source odds don't cover the field",
};

function draftHealthFlags(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const health = (metadata as Record<string, unknown>).draftHealth;
  if (!health || typeof health !== "object") return [];
  const flags = (health as Record<string, unknown>).flags;
  return Array.isArray(flags) ? (flags as string[]) : [];
}

function sourceAlreadyResolved(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return false;
  const stamped = (source as Record<string, unknown>).upstreamResolvedAt;
  return typeof stamped === "string" && stamped.length > 0;
}

const SCOUT_ACTION_LABEL: Record<ScoutAction, string> = {
  resolve_now: "RESOLVE NOW",
  resolve_soon: "Resolve soon",
  watch: "Watch",
  none: "—",
};

const SCOUT_STAGE_LABEL: Record<ScoutStage, string> = {
  met: "condition met",
  near_certain: "near-certain",
  likely: "likely",
  watch: "watch",
};

function scoutFindingToItem(finding: ScoutFinding): OpsAlertItem {
  const a = finding.assessment;
  const conf = Math.round(a.confidence * 100);
  const detail =
    `${SCOUT_ACTION_LABEL[a.recommendedAction]} · ${SCOUT_STAGE_LABEL[a.stage]} · ` +
    `${conf}% → ${a.leaning}${finding.changed ? " · NEW" : ""} — ${a.whatChanged}`;
  return {
    text: finding.title,
    detail,
    // One-tap: opens the admin resolve dialog for this market.
    url: adminResolveMarketUrl(finding.marketId),
  };
}

function marketUrl(slug: string): string {
  return `${getAdminBaseUrl()}/markets/${slug}`;
}

function formatDuration(ms: number): string {
  const absMs = Math.abs(ms);
  const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((absMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((absMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Active-bet counts keyed by marketId for the given markets. */
async function getActiveBetCounts(marketIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (marketIds.length === 0) return counts;
  const rows = await db
    .select({
      marketId: marketBets.marketId,
      n: sql<number>`count(*)::int`,
    })
    .from(marketBets)
    .where(
      and(
        inArray(marketBets.marketId, marketIds),
        eq(marketBets.status, "active"),
      ),
    )
    .groupBy(marketBets.marketId);
  for (const r of rows) counts.set(r.marketId, Number(r.n) || 0);
  return counts;
}

async function runMarketOpsDigestOnce(): Promise<MarketOpsDigestResult> {
  const now = new Date();
  const closingCutoff = new Date(now.getTime() + CLOSING_SOON_WINDOW_MS);

  const [closingSoonRows, pendingRows] = await Promise.all([
    db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        slug: predictionMarkets.slug,
        status: predictionMarkets.status,
        endAt: predictionMarkets.endAt,
      })
      .from(predictionMarkets)
      .where(
        and(
          eq(predictionMarkets.marketType, "community"),
          eq(predictionMarkets.status, "OPEN"),
          gt(predictionMarkets.endAt, now),
          lte(predictionMarkets.endAt, closingCutoff),
        ),
      )
      .orderBy(asc(predictionMarkets.endAt)),
    db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        slug: predictionMarkets.slug,
        status: predictionMarkets.status,
        endAt: predictionMarkets.endAt,
      })
      .from(predictionMarkets)
      .where(
        and(
          eq(predictionMarkets.marketType, "community"),
          eq(predictionMarkets.status, "CLOSED_PENDING"),
        ),
      )
      .orderBy(asc(predictionMarkets.endAt)),
  ]);

  // Unpublished scout output. A draft whose endAt passes is auto-voided as
  // "Draft expired unpublished", so an unreviewed queue silently throws away
  // the scout's work — 17 went that way in the 11 days before this section
  // existed, with nothing telling the operator to look.
  const draftRows = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      endAt: predictionMarkets.endAt,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.visibility, "draft"),
        eq(predictionMarkets.status, "OPEN"),
      ),
    )
    .orderBy(asc(predictionMarkets.endAt));

  const allIds = [
    ...closingSoonRows.map((r) => r.id),
    ...pendingRows.map((r) => r.id),
  ];
  const betCounts = await getActiveBetCounts(allIds);

  const stuckRows = pendingRows.filter(
    (r) => now.getTime() - new Date(r.endAt).getTime() > STUCK_AFTER_MS,
  );

  // AI early-resolution scout. No-op (empty findings) unless the kill switch
  // is on. Runs inline so the digest is one consolidated daily email. Never
  // lets a scout failure break the operational digest.
  let scout = {
    enabled: false,
    findings: [] as ScoutFinding[],
  };
  try {
    const scoutResult = await runResolutionScout();
    scout = { enabled: scoutResult.enabled, findings: scoutResult.findings };
  } catch (err) {
    log(
      `[MarketOpsDigest] Scout run failed (continuing with ops sections): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const scoutResolveNow = scout.findings.filter(
    (f) => f.assessment.recommendedAction === "resolve_now",
  ).length;

  const toItem = (
    r: DigestMarketRow,
    detailPrefix: string,
    /** Actionable rows deep-link to the admin resolve dialog; informational
     *  rows keep the public market page. */
    linkToResolve = false,
  ): OpsAlertItem => {
    const bets = betCounts.get(r.id) ?? 0;
    const betLabel = `${bets} active bet${bets === 1 ? "" : "s"}`;
    return {
      text: r.title,
      detail: `${detailPrefix} · ${betLabel}`,
      url: linkToResolve ? adminResolveMarketUrl(r.id) : marketUrl(r.slug),
    };
  };

  const closingItems = closingSoonRows.map((r) =>
    toItem(r, `resolves in ${formatDuration(new Date(r.endAt).getTime() - now.getTime())}`),
  );

  const pendingItems = pendingRows.map((r) => {
    const overdueMs = now.getTime() - new Date(r.endAt).getTime();
    const stuck = overdueMs > STUCK_AFTER_MS;
    const overdueLabel =
      overdueMs > 0 ? `overdue ${formatDuration(overdueMs)}` : "just closed";
    return toItem(r, `${stuck ? "STUCK · " : ""}${overdueLabel}`, true);
  });

  const scoutItems = scout.findings.map(scoutFindingToItem);

  const draftsAnnotated = draftRows.map((r) => {
    const flags = draftHealthFlags(r.metadata);
    const settled = sourceAlreadyResolved(r.metadata);
    const msLeft = new Date(r.endAt).getTime() - now.getTime();
    return { row: r, flags, settled, msLeft };
  });
  const draftsReady = draftsAnnotated.filter(
    (d) => !d.settled && d.flags.length === 0,
  );
  const draftsExpiringSoon = draftsAnnotated.filter(
    (d) => d.msLeft > 0 && d.msLeft <= CLOSING_SOON_WINDOW_MS,
  );

  // Lead with what is about to be lost, then what is publishable as-is.
  // Flagged drafts that aren't urgent stay out of the email — they're visible
  // in the CMS with badges, and listing 50 of them daily would train the
  // operator to ignore the digest.
  const draftItems: OpsAlertItem[] = [
    ...draftsExpiringSoon.map((d) => ({
      text: d.row.title,
      detail:
        `EXPIRES IN ${formatDuration(d.msLeft)} — publish or it auto-voids` +
        (d.settled
          ? " · source already settled, can't publish"
          : d.flags.length > 0
            ? ` · ${d.flags.map((f) => DRAFT_HEALTH_LABEL[f] ?? f).join(", ")}`
            : ""),
      url: adminWorldMarketsUrl(),
    })),
    ...draftsReady
      .filter((d) => d.msLeft > CLOSING_SOON_WINDOW_MS)
      .slice(0, 10)
      .map((d) => ({
        text: d.row.title,
        detail: `ready to publish · resolves in ${formatDuration(d.msLeft)}`,
        url: adminWorldMarketsUrl(),
      })),
  ];

  const flaggedCount = draftsAnnotated.length - draftsReady.length;

  const sections: OpsAlertSection[] = [
    {
      heading: "Needs resolution",
      emoji: "\u{1F534}",
      items: pendingItems,
      emptyText: "No markets awaiting resolution.",
    },
    {
      heading: "Scout suggests reviewing",
      emoji: "\u{1F514}",
      items: scoutItems,
      emptyText: scout.enabled
        ? "No early-resolution signals today."
        : "AI scout is off (set RESOLUTION_SCOUT_LLM_ENABLED to enable).",
    },
    {
      heading: "Resolves within 48h",
      emoji: "\u{1F7E1}",
      items: closingItems,
      emptyText: "Nothing closing in the next 48 hours.",
    },
    {
      heading: `Drafts to review (${draftsReady.length} ready, ${flaggedCount} flagged)`,
      emoji: "\u{1F4DD}",
      items: draftItems,
      emptyText:
        draftsAnnotated.length > 0
          ? `${draftsAnnotated.length} drafts queued, none urgent or unflagged.`
          : "No drafts waiting.",
    },
  ];

  const severity =
    stuckRows.length > 0 || scoutResolveNow > 0
      ? "critical"
      : pendingRows.length > 0 ||
          scout.findings.length > 0 ||
          // A draft expiring today is a same-day decision: after that the
          // resolver voids it and the scout's work is gone.
          draftsExpiringSoon.length > 0
        ? "warning"
        : "info";

  const totalPending = pendingRows.length;
  const summaryParts: string[] = [];
  if (totalPending > 0) summaryParts.push(`${totalPending} awaiting resolution`);
  if (stuckRows.length > 0) summaryParts.push(`${stuckRows.length} stuck >24h`);
  if (scoutResolveNow > 0)
    summaryParts.push(`${scoutResolveNow} resolvable now (AI)`);
  if (scout.findings.length > 0)
    summaryParts.push(`${scout.findings.length} scout signal${scout.findings.length === 1 ? "" : "s"}`);
  if (closingSoonRows.length > 0)
    summaryParts.push(`${closingSoonRows.length} closing within 48h`);
  if (draftsExpiringSoon.length > 0)
    summaryParts.push(`${draftsExpiringSoon.length} draft${draftsExpiringSoon.length === 1 ? "" : "s"} expiring unreviewed`);
  else if (draftsReady.length > 0)
    summaryParts.push(`${draftsReady.length} draft${draftsReady.length === 1 ? "" : "s"} ready to publish`);
  const summary =
    summaryParts.length > 0
      ? `World Markets: ${summaryParts.join(" · ")}.`
      : "World Markets: all clear — nothing needs resolution.";

  const dateKey = now.toISOString().slice(0, 10);
  const alert: OpsAlert = {
    kind: "market_ops_digest",
    severity,
    title: "World Markets daily digest",
    summary,
    sections,
    ctaUrl: adminWorldMarketsUrl(),
    ctaLabel: "Open World Markets CMS",
    idempotencyKeyBase: `market_ops_digest:${dateKey}`,
  };

  const dispatch = await sendOpsAlert(alert);

  log(
    `[MarketOpsDigest] closingSoon=${closingSoonRows.length} ` +
      `needsResolution=${totalPending} stuck=${stuckRows.length} ` +
      `scoutFindings=${scout.findings.length} scoutResolveNow=${scoutResolveNow} ` +
      `draftsAwaitingReview=${draftsAnnotated.length} draftsReady=${draftsReady.length} ` +
      `draftsExpiringSoon=${draftsExpiringSoon.length} ` +
      `delivered=${dispatch.delivered} skipped=${dispatch.skipped} failed=${dispatch.failed}`,
  );

  return {
    closingSoon: closingSoonRows.length,
    needsResolution: totalPending,
    stuck: stuckRows.length,
    scoutFindings: scout.findings.length,
    scoutResolveNow,
    draftsAwaitingReview: draftsAnnotated.length,
    draftsReady: draftsReady.length,
    draftsExpiringSoon: draftsExpiringSoon.length,
    alert: {
      delivered: dispatch.delivered,
      skipped: dispatch.skipped,
      failed: dispatch.failed,
    },
  };
}

export async function runMarketOpsDigest(): Promise<MarketOpsDigestResult> {
  const locked = await withDbAdvisoryLock(
    MARKET_OPS_DIGEST_LOCK_KEY,
    "MarketOpsDigest",
    runMarketOpsDigestOnce,
  );
  if (!locked.acquired || !locked.result) {
    if (!locked.acquired) {
      log("[MarketOpsDigest] Skipping run; another instance holds the lock");
    }
    return {
      closingSoon: 0,
      needsResolution: 0,
      stuck: 0,
      scoutFindings: 0,
      scoutResolveNow: 0,
      draftsAwaitingReview: 0,
      draftsReady: 0,
      draftsExpiringSoon: 0,
      alert: { delivered: 0, skipped: 1, failed: 0 },
    };
  }
  return locked.result;
}

/**
 * Instant "needs resolution" ping. Fired by the resolver the moment a
 * community market flips to CLOSED_PENDING. Idempotency in email_send_log
 * (keyed per market) means a restart / re-run can't double-send. Best
 * effort — never throws into the resolver loop.
 */
export async function sendMarketNeedsResolutionAlert(market: {
  id: string;
  title: string;
  slug: string;
  endAt: Date | string | null;
  pendingReason?: string;
}): Promise<void> {
  try {
    const endAtMs = market.endAt ? new Date(market.endAt).getTime() : null;
    const isBackstop =
      market.pendingReason === "backstop_reached_unresolved";
    const detail = isBackstop
      ? "Source hasn't resolved by the backstop — make a manual call or void"
      : endAtMs !== null
        ? `Closed ${new Date(endAtMs).toISOString().slice(0, 16).replace("T", " ")} UTC — pick the winning outcome`
        : "Pick the winning outcome";

    await sendOpsAlert({
      kind: "market_needs_resolution",
      severity: isBackstop ? "critical" : "warning",
      title: isBackstop
        ? "World Market backstop reached — still unresolved"
        : "World Market needs resolution",
      summary: isBackstop
        ? `"${market.title}" hit its resolution backstop and the upstream source still hasn't settled. Make a manual call or void.`
        : `"${market.title}" has closed and is awaiting a manual winner.`,
      sections: [
        {
          heading: isBackstop ? "Backstop reached" : "Awaiting resolution",
          emoji: "\u{1F534}",
          items: [
            {
              text: market.title,
              detail,
              url: adminResolveMarketUrl(market.id),
            },
          ],
        },
      ],
      // One tap from the email straight to the resolve dialog on the phone.
      ctaUrl: adminResolveMarketUrl(market.id),
      ctaLabel: "Resolve this market",
      idempotencyKeyBase: `market_needs_resolution:${market.id}`,
    });
  } catch (err) {
    log(
      `[MarketOpsDigest] needs-resolution alert failed for ${market.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
