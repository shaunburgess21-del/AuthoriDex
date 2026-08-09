/**
 * Audit scouted World Market drafts against their live Polymarket source.
 *
 * Read-only. Classifies every draft so we can see which anomaly classes the
 * scout is actually producing, rather than guessing at them:
 *
 *   resolved_upstream  Source has settled. Publishing hands agents a known
 *                      winner; the watcher will never recommend settlement
 *                      because it stamped the draft while it was hidden.
 *   source_closed      Every sub-market closed, but no single winner mapped.
 *   source_gone        Event missing / inactive / archived upstream.
 *   ends_soon          endAt inside the review window — will expire before
 *                      anyone reviews it.
 *   already_expired    endAt already past.
 *   schedule_drift     Our endAt no longer matches the source endDate.
 *   ladder             Cumulative "by date / threshold" source.
 *   oversubscribed     Named legs price above 1 without a ladder verdict.
 *   no_catch_all       Non-exhaustive field with no "Other" leg.
 *   thin_liquidity     Source 24h volume below a usable threshold.
 *   scrambled_order    Numeric bracket legs stored out of numeric order.
 *
 * Run:
 *   npx tsx --env-file=.env ops/audit-world-market-drafts.ts
 *   npx tsx --env-file=.env ops/audit-world-market-drafts.ts --json
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const AS_JSON = process.argv.slice(2).includes("--json");

/** endAt closer than this is unlikely to survive a daily review cycle. */
const ENDS_SOON_HOURS = 48;
/**
 * Source 24h volume below this rarely supports a meaningful price. Mirrors
 * the scout's import floor (SCOUT_MIN_SOURCE_VOLUME_24H_USD) so the audit
 * flags exactly what the importer would now reject.
 */
const THIN_VOLUME_USD = Number(process.env.SCOUT_MIN_SOURCE_VOLUME_24H_USD ?? 250);
/** endAt vs source endDate gap that counts as drift. */
const DRIFT_MS = 60 * 60 * 1000;

const GAMMA = "https://gamma-api.polymarket.com/events";

interface GammaSub {
  id?: string | number;
  groupItemTitle?: string;
  question?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  outcomePrices?: string;
}

interface GammaEvent {
  id?: string | number;
  title?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  volume24hr?: number | string;
  markets?: GammaSub[];
}

async function fetchEvent(id: string): Promise<GammaEvent | null> {
  try {
    const res = await fetch(`${GAMMA}?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as GammaEvent[];
    return Array.isArray(body) && body[0] ? body[0] : null;
  } catch {
    return null;
  }
}

function yesPrice(m: GammaSub): number | null {
  try {
    const arr = JSON.parse(m.outcomePrices ?? "[]") as string[];
    const v = Number(arr[0]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketEntries } = await import("../shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { detectCumulativeLadder, isOtherStyleOutcomeLabel } = await import(
    "../shared/lib/other-outcome"
  );
  const { parseOutcomeMagnitude } = await import("../shared/lib/outcome-ordering");

  const drafts = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      endAt: predictionMarkets.endAt,
      visibility: predictionMarkets.visibility,
      status: predictionMarkets.status,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.visibility, "draft"),
      ),
    );

  const now = Date.now();
  const findings: Array<{
    id: string;
    title: string;
    flags: string[];
    detail: string[];
  }> = [];
  const tally = new Map<string, number>();
  const bump = (f: string) => tally.set(f, (tally.get(f) ?? 0) + 1);
  const seenSources = new Map<string, string>();

  for (const d of drafts) {
    const meta =
      d.metadata && typeof d.metadata === "object"
        ? (d.metadata as Record<string, unknown>)
        : {};
    const src =
      meta.source && typeof meta.source === "object"
        ? (meta.source as Record<string, unknown>)
        : {};
    const externalId = typeof src.externalId === "string" ? src.externalId : null;

    const flags: string[] = [];
    const detail: string[] = [];

    const endMs = d.endAt ? new Date(d.endAt).getTime() : NaN;
    if (Number.isFinite(endMs)) {
      if (endMs <= now) {
        flags.push("already_expired");
      } else if (endMs - now < ENDS_SOON_HOURS * 3600_000) {
        flags.push("ends_soon");
        detail.push(`ends in ${Math.round((endMs - now) / 3600_000)}h`);
      }
    }

    const entries = await db
      .select({ label: marketEntries.label, order: marketEntries.displayOrder })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, d.id))
      .orderBy(marketEntries.displayOrder);
    const labels = entries.map((e) => e.label ?? "");
    const named = labels.filter((l) => !isOtherStyleOutcomeLabel(l));
    const hasCatchAll = labels.length !== named.length;

    // Numeric bracket legs stored out of order (price-sort scrambling).
    const mags = named.map((l) => parseOutcomeMagnitude(l));
    if (mags.length >= 2 && mags.every((m): m is number => m !== null)) {
      const sorted = [...mags].sort((a, b) => a - b);
      if (mags.some((m, i) => m !== sorted[i])) {
        flags.push("scrambled_order");
        detail.push(named.join(" | "));
      }
    }

    if (!externalId) {
      flags.push("no_source");
      findings.push({ id: d.id, title: d.title ?? "", flags, detail });
      flags.forEach(bump);
      continue;
    }

    const prior = seenSources.get(externalId);
    if (prior) {
      flags.push("duplicate_source");
      detail.push(`shares source ${externalId} with ${prior.slice(0, 8)}`);
    } else {
      seenSources.set(externalId, d.id);
    }

    const ev = await fetchEvent(externalId);
    if (!ev) {
      flags.push("source_gone");
    } else {
      if (ev.closed === true || ev.active === false || ev.archived === true) {
        flags.push("source_gone");
        detail.push(
          `event closed=${ev.closed} active=${ev.active} archived=${ev.archived}`,
        );
      }

      const subs = ev.markets ?? [];
      const prices = subs.map(yesPrice);
      const winners = subs.filter((_, i) => (prices[i] ?? 0) >= 0.99);
      const allClosed = subs.length > 0 && subs.every((m) => m.closed === true);

      if (winners.length === 1 && allClosed) {
        flags.push("resolved_upstream");
        detail.push(
          `winner "${winners[0].groupItemTitle ?? winners[0].question ?? "?"}"`,
        );
      } else if (allClosed) {
        flags.push("source_closed");
      }

      const vol = Number(ev.volume24hr ?? 0);
      if (Number.isFinite(vol) && vol < THIN_VOLUME_USD) {
        flags.push("thin_liquidity");
        detail.push(`24h vol $${Math.round(vol)}`);
      }

      const srcEnd = ev.endDate ? Date.parse(ev.endDate) : NaN;
      if (Number.isFinite(srcEnd) && Number.isFinite(endMs)) {
        if (Math.abs(srcEnd - endMs) > DRIFT_MS) {
          flags.push("schedule_drift");
          detail.push(
            `ours ${new Date(endMs).toISOString().slice(0, 10)} vs source ${new Date(srcEnd).toISOString().slice(0, 10)}`,
          );
        }
      }

      // Ladder / exhaustiveness on the source book.
      const openSubs = subs.filter((m) => m.closed !== true);
      if (openSubs.length >= 2) {
        const subLabels = openSubs.map((m) => m.groupItemTitle || m.question || "");
        const subPrices = openSubs.map((m) => yesPrice(m));
        const ladder = detectCumulativeLadder({
          labels: subLabels,
          prices: subPrices,
          sourceEndDates: openSubs.map((m) => m.endDate ?? null),
          mutuallyExclusiveSource: ev.negRisk === true || ev.enableNegRisk === true,
        });
        if (ladder.isLadder) {
          flags.push("ladder");
          detail.push(ladder.signals.join(","));
        }
        const sum = subPrices.reduce<number>((s, p) => s + (p ?? 0), 0);
        if (!ladder.isLadder && sum > 1.02) {
          flags.push("oversubscribed");
          detail.push(`Σ=${sum.toFixed(2)}`);
        }
        if (!hasCatchAll && sum < 0.97 && named.length >= 3) {
          flags.push("no_catch_all");
          detail.push(`Σ named=${sum.toFixed(2)}`);
        }
      }
    }

    if (flags.length) {
      findings.push({ id: d.id, title: d.title ?? "", flags, detail });
      flags.forEach(bump);
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ total: drafts.length, findings }, null, 2));
  } else {
    console.log(`\n[audit-world-market-drafts] ${drafts.length} drafts scanned\n`);
    console.log("── Tally ──");
    for (const [flag, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${flag}`);
    }
    console.log(`\n── Flagged drafts (${findings.length}) ──`);
    for (const f of findings) {
      console.log(`\n  ${f.title}`);
      console.log(`    ${f.id.slice(0, 8)}  [${f.flags.join(", ")}]`);
      for (const d of f.detail) console.log(`      ${d}`);
    }
    const clean = drafts.length - findings.length;
    console.log(`\n  ${clean} draft(s) with no flags.\n`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[audit-world-market-drafts] failed:", err);
  process.exit(1);
});
