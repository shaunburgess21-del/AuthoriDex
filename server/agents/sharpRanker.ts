/**
 * LLM market-ranker for sharp-band agents.
 *
 * Once per agent-runner sweep, this module asks GPT-5.4 to scan the native
 * markets being evaluated and return the top N where it sees the strongest
 * combination of (a) clear directional signal and (b) live pool that hasn't
 * caught up yet. Sharp agents prefer-sample from the resulting list, so as
 * a cohort they end the week consistently focused on the highest-edge
 * markets — exactly what you'd see from a real "sharps row" on a
 * leaderboard.
 *
 * Cost profile: ONE chat-completion per sweep (no web search, ~600 input
 * tokens, ~250 output tokens). At 48 sweeps/day × ~$0.005/call ≈ $7/month.
 *
 * Cache: result is held in-memory for SHARP_RANKER_TTL_MS so we don't
 * re-call when consecutive sweeps see the same market set, and we hit the
 * LLM at most once per process tick. The kill switch
 * `SHARP_RANKER_LLM_ENABLED` lets ops disable the call entirely without a
 * deploy when troubleshooting cost.
 */

import OpenAI from "openai";
import { log } from "../log";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import type { MarketWithEntries, TrendSignals } from "./types";

/**
 * Lazy-init the OpenAI client.
 *
 * Constructing `new OpenAI()` at module-load time throws in any environment
 * that doesn't have `OPENAI_API_KEY` (or `AI_INTEGRATIONS_OPENAI_API_KEY`)
 * set — including CI runners and unit-test workers that exercise the
 * ranker's pure parser without ever firing an LLM call. The lazy form
 * preserves the same eventual behaviour (throws iff the key is missing
 * AND the ranker is actually invoked) while letting `parseRankerResponse`
 * and friends be imported safely from tests.
 */
let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  _openaiClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openaiClient;
}

const SHARP_RANKER_LLM_ENABLED = process.env.SHARP_RANKER_LLM_ENABLED !== "false";
const SHARP_RANKER_TTL_MS = 25 * 60 * 1000;
const SHARP_RANKER_TIMEOUT_MS = 25_000;
// Bumped from 700 in Agent v2: each pick now carries 6 fields (edgeProb,
// conviction, direction, reasoning + side + marketId) so worst-case output
// is ~480 tokens. Buffer keeps responses from getting truncated mid-JSON.
const SHARP_RANKER_MAX_TOKENS = 900;
const SHARP_RANKER_TOP_N = 6;

export interface SharpRankerPick {
  marketId: string;
  /** Entry label the LLM is backing — exact text match against the entry
   * we showed it in the prompt. Parser drops picks whose side doesn't
   * resolve to a real entry. */
  side: string;
  /** LLM's view of "true" probability for this side, clamped to [0, 1]. */
  edgeProb: number;
  /**
   * Crowd-implied probability for this side at ranker time, computed
   * server-side from the market's stake split (NOT taken from the LLM).
   * For binary entries with `noStake`: `totalStake / (totalStake + noStake)`.
   * For race-style multi-entry: `entry.totalStake / sum(all entries' stakes)`.
   * Defaults to 0.5 when no stakes have landed yet.
   */
  currentPrice: number;
  /** Signed difference: `edgeProb - currentPrice`. Positive = LLM more
   * bullish than the crowd. Recomputed server-side; we never trust the
   * LLM to do its own arithmetic. */
  edge: number;
  /** LLM's self-reported confidence in this assessment, clamped to [0, 1].
   * Used by `computeAgentStakeAmount` to scale stake size in the
   * `convictionFactor * edgeFactor` curve. */
  conviction: number;
  /** Explicit directional tag — UP if the LLM is bullish on the side
   * resolving in the "yes" direction, DOWN if bearish, FLAT if neutral.
   * Mirrors the new `TrendSignals.trendDirection` so deterministic and
   * LLM paths share the same vocabulary. */
  direction: "UP" | "DOWN" | "FLAT";
  reasoning: string;
  /** Stored at generation time so the admin tile can show a readable
   * label without re-querying the markets table on every refresh. */
  marketTitle?: string;
  marketType?: string;
}

export interface SharpRankerSnapshot {
  picks: SharpRankerPick[];
  generatedAt: number;
  marketsConsidered: number;
  source: "llm" | "fallback" | "disabled" | "cache";
  costEstimateUsd: number | null;
  /**
   * Stable hash of the sorted market-IDs that produced this snapshot.
   * Used by `getSharpRanking` to invalidate the cache when consecutive
   * sweeps see a different market set — without this, picks generated
   * for sweep N would silently leak into sweep N+1, where some of those
   * markets may not even appear (so an agent could be told "this is a
   * priority market" for a market that isn't in its current loop).
   */
  inputKey: string;
}

interface RankableMarket {
  market: MarketWithEntries;
  signals: TrendSignals | null;
  entrySignals?: Map<string, TrendSignals>;
}

let lastSnapshot: SharpRankerSnapshot | null = null;
let inflight: Promise<SharpRankerSnapshot> | null = null;
let inflightKey: string | null = null;

/**
 * Stable cache key for the input set. We hash sorted market IDs only:
 * if the same markets are submitted in a different order across sweeps
 * we still hit the cache. We don't include signals because the same
 * market with slightly different signal values within the TTL window
 * is exactly the case the cache is designed to absorb.
 */
function computeInputKey(rankable: RankableMarket[]): string {
  return rankable
    .map((r) => r.market.id)
    .filter((id) => typeof id === "string" && id.length > 0)
    .sort()
    .join(",");
}

/**
 * Returns the latest sharp-ranking snapshot, regenerating if it's stale.
 * Safe to call from many call sites in the same sweep — the in-flight
 * dedupe guarantees only ONE LLM call per regeneration window.
 *
 * Cache validity requires BOTH: (a) the snapshot is within
 * `SHARP_RANKER_TTL_MS`, AND (b) it was generated for the same set of
 * market IDs. Different market set → regenerate, even within TTL,
 * because handing back picks targeting markets the caller isn't
 * iterating over silently breaks the runner's `priority: high`
 * routing (agents would never see those picks).
 */
export async function getSharpRanking(
  rankable: RankableMarket[],
): Promise<SharpRankerSnapshot> {
  if (!SHARP_RANKER_LLM_ENABLED) {
    return {
      picks: [],
      generatedAt: Date.now(),
      marketsConsidered: rankable.length,
      source: "disabled",
      costEstimateUsd: 0,
      inputKey: computeInputKey(rankable),
    };
  }

  const inputKey = computeInputKey(rankable);

  if (
    lastSnapshot &&
    lastSnapshot.inputKey === inputKey &&
    Date.now() - lastSnapshot.generatedAt < SHARP_RANKER_TTL_MS
  ) {
    return { ...lastSnapshot, source: "cache" };
  }

  if (inflight && inflightKey === inputKey) return inflight;

  inflightKey = inputKey;
  inflight = generateRanking(rankable, inputKey)
    .catch((err) => {
      log(`[SharpRanker] generation failed: ${err instanceof Error ? err.message : err}`);
      const fallback: SharpRankerSnapshot = {
        picks: [],
        generatedAt: Date.now(),
        marketsConsidered: rankable.length,
        source: "fallback",
        costEstimateUsd: 0,
        inputKey,
      };
      lastSnapshot = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
      inflightKey = null;
    });

  return inflight;
}

export function getCachedSharpRanking(): SharpRankerSnapshot | null {
  return lastSnapshot;
}

async function generateRanking(
  rankable: RankableMarket[],
  inputKey: string,
): Promise<SharpRankerSnapshot> {
  // Community markets are now eligible alongside native ones. They use
  // a different formatter (no per-person `signals`, free-text options
  // instead of entries), but the LLM treats them under the same edge
  // contract: `edgeProb` vs server-computed `crowdPrice`.
  const eligible = rankable.filter((r) => r.market.entries.length > 0);

  if (eligible.length === 0) {
    const empty: SharpRankerSnapshot = {
      picks: [],
      generatedAt: Date.now(),
      marketsConsidered: 0,
      source: "llm",
      costEstimateUsd: 0,
      inputKey,
    };
    lastSnapshot = empty;
    return empty;
  }

  const summary = eligible
    .map((item) =>
      item.market.marketType === "community"
        ? formatCommunityMarketForRanker(item)
        : formatMarketForRanker(item),
    )
    .join("\n\n");

  const systemPrompt = [
    "You are a sharp prediction-market analyst evaluating two kinds of markets:",
    "  - native (h2h, gainer, updown, jackpot): person-linked, with trend signals like trendScore, fame, 7d/24h delta, trendDirection (UP/DOWN/FLAT), wiki pulse, news level, vsOpen.",
    "  - community: free-text options (sports outcomes, awards, elections), no per-person signals — reason from the option text and category.",
    "",
    `Pick up to ${SHARP_RANKER_TOP_N} markets where you see the strongest EDGE — i.e. cases where:`,
    "- For native markets: signals point clearly in one direction AND the crowd-implied price (crowdPrice) does NOT yet reflect that view, OR there's a structural pattern (trend reversal, news catalyst, fame mismatch) the simple model misses.",
    "- For community markets: domain knowledge (sports form, political base rates, award fundamentals) materially disagrees with the crowd's stake split.",
    "",
    "For each pick output SIX fields:",
    "- marketId: copy from the market header",
    "- side: EXACT entry/option label as shown (case-sensitive, must match)",
    "- edgeProb: YOUR probability (0.0..1.0) that this side wins",
    "- conviction: YOUR confidence in this assessment (0.0..1.0)",
    "- direction: 'UP' if you are bullish on this side resolving yes, 'DOWN' if bearish, 'FLAT' if borderline",
    "- reasoning: ONE sentence, max 30 words",
    "",
    "Calibration: edgeProb=0.50 means you think it's a coin-flip; only return picks where |edgeProb - crowdPrice| >= 0.05.",
    "Conviction 0.8+ should be reserved for structural reads, not routine momentum agreement.",
    "DO NOT just pick the markets with the largest moves. Pick where you see UNDERPRICED conviction.",
    "Be ruthless — most markets are noise. If fewer than 6 have real edge, return fewer.",
    "",
    "Output STRICT JSON only, no prose:",
    '{"picks":[{"marketId":"<id>","side":"<exact entry label>","edgeProb":0.62,"conviction":0.70,"direction":"UP","reasoning":"<one sentence>"}]}',
  ].join("\n");

  const userPrompt = `MARKETS:\n\n${summary}`;

  const model = getAiModel("sharpRanker");
  const tokenLimit = getChatCompletionTokenLimit(model, SHARP_RANKER_MAX_TOKENS);

  const completion = await Promise.race([
    getOpenAIClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...tokenLimit,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("sharp ranker timeout")), SHARP_RANKER_TIMEOUT_MS),
    ),
  ]);

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  const parsed = parseRankerResponse(raw, eligible);

  const usage = completion.usage;
  const costEstimateUsd = usage
    ? estimateCost(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    : null;

  const snapshot: SharpRankerSnapshot = {
    picks: parsed,
    generatedAt: Date.now(),
    marketsConsidered: eligible.length,
    source: "llm",
    costEstimateUsd,
    inputKey,
  };

  lastSnapshot = snapshot;
  log(
    `[SharpRanker] picked ${parsed.length}/${SHARP_RANKER_TOP_N} from ${eligible.length} markets, cost≈$${costEstimateUsd?.toFixed(4) ?? "?"}`,
  );
  return snapshot;
}

/**
 * How many entries to include in the LLM prompt per native market.
 *
 * H2H and UpDown always have exactly two entries, so the cap is moot
 * for them. Race / gainer markets, however, can carry 5+ candidates —
 * with the old hard cap of 4 entries, candidates 5+ never appeared in
 * the prompt at all (silent under-coverage: the LLM literally couldn't
 * pick them, no matter how strong the edge). Race markets now use a
 * larger cap that keeps a sensible token budget without arbitrarily
 * dropping entries.
 *
 * 12 was chosen as a safe upper bound — it covers every race configured
 * in the generator today, leaves headroom for one or two oversized
 * cards, and keeps the per-market prompt block well under 600 chars
 * even at full population (entries lines are ~40 chars each).
 */
const SHARP_RANKER_ENTRY_CAP_DEFAULT = 4;
const SHARP_RANKER_ENTRY_CAP_RACE = 12;

function entryCapForMarket(marketType: string): number {
  return marketType === "gainer" ? SHARP_RANKER_ENTRY_CAP_RACE : SHARP_RANKER_ENTRY_CAP_DEFAULT;
}

function formatMarketForRanker(item: RankableMarket): string {
  const { market, signals, entrySignals } = item;
  const lines: string[] = [];
  lines.push(`# ${market.id}`);
  lines.push(`type: ${market.marketType}`);
  lines.push(`title: ${market.title.slice(0, 90)}`);
  if (market.category) lines.push(`category: ${market.category}`);

  if (signals) {
    lines.push(
      `signals: trendScore=${Math.round(signals.trendScore)}, fame=${Math.round(signals.fameIndex)}, baseline=${Math.round(signals.scoreBaseline)}, 7d=${signals.scoreDelta7d.toFixed(1)}, 24h=${signals.change24h.toFixed(1)}, dir=${signals.trendDirection}, mom=${signals.momentum}, wiki=${signals.wikiPulse}, news=${signals.newsLevel}${signals.pctChangeVsOpen != null ? `, vsOpen=${(signals.pctChangeVsOpen * 100).toFixed(1)}%` : ""}`,
    );
  }

  const cap = entryCapForMarket(market.marketType);
  const entries = market.entries
    .slice(0, cap)
    .map((e) => {
      const sig = entrySignals?.get(e.id);
      // Crowd-implied price computed the same way the parser will, so the
      // LLM and the server share the exact same notion of "what the crowd
      // currently thinks". Without this, the LLM would be guessing at
      // crowdPrice from raw stake numbers and its calibration check
      // (|edgeProb - crowdPrice| >= 0.05) would be unreliable.
      const crowdPrice = computeEntryCrowdPrice(e, market.entries);
      const entrySig = sig
        ? ` [fame=${Math.round(sig.fameIndex)}, 7d=${sig.scoreDelta7d.toFixed(1)}, dir=${sig.trendDirection}, wiki=${sig.wikiPulse}, news=${sig.newsLevel}${sig.pctChangeVsOpen != null ? `, vsOpen=${(sig.pctChangeVsOpen * 100).toFixed(1)}%` : ""}]`
        : "";
      return `  - ${e.label ?? "(unnamed)"} → crowdPrice=${crowdPrice.toFixed(2)} stake=${e.totalStake}${e.noStake != null ? `/no=${e.noStake}` : ""}${entrySig}`;
    })
    .join("\n");
  if (entries) lines.push("entries:");
  if (entries) lines.push(entries);

  return lines.join("\n");
}

/**
 * Test-only export of the per-market-type entry cap. Used by the
 * formatter test to assert race markets surface all candidates while
 * H2H / UpDown stay capped at the conservative default.
 */
export function _entryCapForMarketForTesting(marketType: string): number {
  return entryCapForMarket(marketType);
}

/**
 * Test-only re-export of the formatter so we can assert end-to-end
 * that race markets with 6+ entries render every entry in the prompt.
 */
export function _formatMarketForRankerForTesting(item: RankableMarket): string {
  return formatMarketForRanker(item);
}

/**
 * Crowd-implied probability for one entry, server-truth.
 *
 * Two market shapes:
 *   - Binary per-entry (entry has `noStake`): yes/no pool on this entry —
 *     `totalStake / (totalStake + noStake)`. Up/Down lives here too.
 *   - Race-style multi-entry: probability is the entry's share of the
 *     total stake pool across all entries.
 *
 * Falls back to 0.5 when no stakes have landed yet (zero pool). This matches
 * what an unconditioned uniform prior over outcomes would say, and avoids
 * div-by-zero. The LLM sees the same number in the prompt, so its edge
 * calculation matches what we recompute in the parser.
 */
function computeEntryCrowdPrice(
  entry: { totalStake: number; noStake?: number },
  allEntries: Array<{ totalStake: number }>,
): number {
  if (entry.noStake != null) {
    const denom = entry.totalStake + entry.noStake;
    if (denom <= 0) return 0.5;
    return entry.totalStake / denom;
  }
  const total = allEntries.reduce((sum, e) => sum + Math.max(0, e.totalStake), 0);
  if (total <= 0) return 1 / Math.max(1, allEntries.length);
  return entry.totalStake / total;
}

/**
 * Community/world-market formatter.
 *
 * Different from `formatMarketForRanker` because community markets:
 *   - have free-text option labels rather than tracked-person entries,
 *   - have no per-person `TrendSignals` (no `personId` to look up),
 *   - tend to be longer-lived and more structurally interesting (election
 *     outcomes, sports, awards) than weekly fame markets.
 *
 * We still surface `crowdPrice` per option so the LLM's edgeProb has the
 * same meaning whether the pick is on a native or community market —
 * the server-side parser uses the identical `computeEntryCrowdPrice`
 * helper either way.
 */
function formatCommunityMarketForRanker(item: RankableMarket): string {
  const { market } = item;
  const lines: string[] = [];
  lines.push(`# ${market.id}`);
  lines.push(`type: community`);
  lines.push(`title: ${market.title.slice(0, 120)}`);
  if (market.category) lines.push(`category: ${market.category}`);
  if (market.teaser) lines.push(`teaser: ${market.teaser.slice(0, 200)}`);

  const options = market.entries
    .slice(0, 8)
    .map((e) => {
      const crowdPrice = computeEntryCrowdPrice(e, market.entries);
      return `  - ${e.label ?? "(unnamed)"} → crowdPrice=${crowdPrice.toFixed(2)} stake=${e.totalStake}${e.noStake != null ? `/no=${e.noStake}` : ""}`;
    })
    .join("\n");
  if (options) {
    lines.push("options:");
    lines.push(options);
  }
  return lines.join("\n");
}

/**
 * Minimum |edge| for a pick to count. Below this the LLM is essentially
 * agreeing with the crowd and there's no value to capture; treating those
 * as picks would dilute the signal sharps act on. Same threshold as the
 * AMM's no-edge skip in the runner (0.02 there is the "agent confidence
 * vs current price" gate; 0.03 here is the LLM's "my probability vs the
 * crowd's price" gate — slightly stricter because the LLM has seen the
 * same data the deterministic engine has).
 */
const SHARP_RANKER_MIN_EDGE = 0.03;

function clampUnit(n: unknown, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normaliseDirection(raw: unknown): "UP" | "DOWN" | "FLAT" {
  if (raw === "UP" || raw === "DOWN" || raw === "FLAT") return raw;
  return "FLAT";
}

export function _parseRankerResponseForTesting(
  raw: string,
  eligible: RankableMarket[],
): SharpRankerPick[] {
  return parseRankerResponse(raw, eligible);
}

/**
 * Test-only export of the cache-key derivation. Exposing the helper
 * (rather than testing through `getSharpRanking`) avoids any need to
 * mock the OpenAI client just to assert on key behaviour.
 */
export function _computeInputKeyForTesting(rankable: RankableMarket[]): string {
  return computeInputKey(rankable);
}

export type _RankableMarketForTesting = RankableMarket;

function parseRankerResponse(
  raw: string,
  eligible: RankableMarket[],
): SharpRankerPick[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log(`[SharpRanker] failed to parse response: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  const picksRaw = Array.isArray((parsed as { picks?: unknown })?.picks)
    ? ((parsed as { picks: unknown[] }).picks)
    : [];
  const byId = new Map(eligible.map((e) => [e.market.id, e] as const));

  const out: SharpRankerPick[] = [];
  let droppedNoMarket = 0;
  let droppedNoEntry = 0;
  let droppedNoEdge = 0;

  for (const p of picksRaw) {
    if (typeof p !== "object" || p === null) continue;
    const pick = p as Record<string, unknown>;
    const marketId = typeof pick.marketId === "string" ? pick.marketId : null;
    if (!marketId || !byId.has(marketId)) {
      droppedNoMarket++;
      continue;
    }

    const item = byId.get(marketId)!;
    const market = item.market;
    const sideRaw = typeof pick.side === "string" ? pick.side.trim() : "";
    if (!sideRaw) {
      droppedNoEntry++;
      continue;
    }

    // Resolve the entry by exact label first, then case-insensitive.
    // Dropping picks whose side doesn't map to a real entry keeps the
    // downstream sizing curve from needing to handle "unknown side"
    // — every pick that survives is actionable.
    const entry =
      market.entries.find((e) => e.label === sideRaw)
      ?? market.entries.find((e) => (e.label ?? "").toLowerCase() === sideRaw.toLowerCase());
    if (!entry) {
      droppedNoEntry++;
      continue;
    }

    const edgeProb = clampUnit(pick.edgeProb, 0.5);
    const conviction = clampUnit(pick.conviction, 0.5);
    const currentPrice = computeEntryCrowdPrice(entry, market.entries);
    const edge = edgeProb - currentPrice;

    if (Math.abs(edge) < SHARP_RANKER_MIN_EDGE) {
      droppedNoEdge++;
      continue;
    }

    out.push({
      marketId,
      side: entry.label ?? sideRaw.slice(0, 60),
      edgeProb,
      currentPrice,
      edge,
      conviction,
      direction: normaliseDirection(pick.direction),
      reasoning: typeof pick.reasoning === "string" ? pick.reasoning.slice(0, 240) : "",
      marketTitle: market.title?.slice(0, 120) ?? undefined,
      marketType: market.marketType,
    });

    if (out.length >= SHARP_RANKER_TOP_N) break;
  }

  if (droppedNoMarket || droppedNoEntry || droppedNoEdge) {
    log(
      `[SharpRanker] parser drops: noMarket=${droppedNoMarket} noEntry=${droppedNoEntry} noEdge=${droppedNoEdge}`,
    );
  }

  return out;
}

function estimateCost(promptTokens: number, completionTokens: number): number {
  // GPT-5.4 chat-completion pricing (input ~$5/1M, output ~$15/1M).
  // Adjust if pricing changes — used purely for admin observability.
  return (promptTokens / 1_000_000) * 5 + (completionTokens / 1_000_000) * 15;
}

export function isSharpRankerEnabled(): boolean {
  return SHARP_RANKER_LLM_ENABLED;
}
