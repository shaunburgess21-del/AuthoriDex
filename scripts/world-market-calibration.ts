/**
 * World Market LLM calibration check.
 *
 * Before flipping `WORLD_MARKETS_LLM_ENABLED=true` in production, this
 * script measures whether the LLM is well-calibrated — i.e. when it
 * says "70% probability," does that question actually resolve YES
 * about 70% of the time across a curated sample?
 *
 * An accurate-but-miscalibrated LLM (e.g. 95% confident → right 95%
 * of the time, but 60% confident → right only 50% of the time) will
 * lead agents to systematically over- or under-bid one probability
 * band, draining the house on close-call markets while doing fine on
 * obvious ones. A single accuracy figure won't surface this; binning
 * into bands and computing per-band calibration error will.
 *
 * What this script does:
 *   1. Walks a curated list of 30+ questions with KNOWN outcomes
 *      (resolved by world events before the script was written —
 *      these are NOT genuine open questions).
 *   2. Calls the OpenAI Responses API (web_search enabled, same model
 *      as production world markets) with a neutral analyst prompt
 *      that asks for a YES probability and brief reasoning.
 *   3. Buckets each result into 0.10-wide probability bands.
 *   4. For each band: counts samples, average stated probability,
 *      actual YES rate, calibration error.
 *   5. Prints a stdout table AND writes a dated markdown report to
 *      `ops/world-market-calibration-<YYYY-MM-DD>.md`.
 *
 * Decision rule (see ops/AMM_MONITORING_RUNBOOK.md, future calibration
 * section): re-enable `WORLD_MARKETS_LLM_ENABLED` only if absolute
 * calibration error stays under 0.10 across every band with sample
 * size >= 5. Any band with >0.10 error means agents trading on that
 * probability range will systematically lose money.
 *
 * Cost: ~30 questions × $0.20-0.40 per web_search call = ~$6-12 per
 * run. Run sparingly. Cache results into a JSON file so re-running
 * for analysis-only doesn't re-hit the API.
 *
 * Run with:
 *   npm run world:calibrate
 *   tsx scripts/world-market-calibration.ts [--no-cache] [--out path]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const OpenAI = (await import("openai")).default;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const USE_CACHE = !hasFlag("--no-cache");
const OUT_PATH =
  parseArg("--out") ??
  resolve(
    process.cwd(),
    `ops/world-market-calibration-${new Date().toISOString().slice(0, 10)}.md`,
  );
const CACHE_PATH = resolve(
  process.cwd(),
  "ops/.world-market-calibration-cache.json",
);

// ---------------------------------------------------------------------------
// Curated calibration set — two tranches
// ---------------------------------------------------------------------------
//
// PROBLEM: When the question is something like "Did Argentina win the 2022
// World Cup?", a web-search-enabled LLM finds the headline answer in one
// query and reports ~95% confidence. That measures FACT LOOKUP, not
// probability CALIBRATION on genuinely uncertain events. Production
// world markets are unresolved by design, so a strong score on a
// fact-lookup test gives false confidence to flip the flag.
//
// MITIGATION: We split the set into two tranches with different roles:
//
//   • OBSCURED   — compound conditions that aren't the headline result.
//                  "Did the 2022 World Cup final go to penalties?" is
//                  marginally harder than "Did Argentina win?" but the
//                  reverse-engineered probability is more meaningful.
//                  These are the source-of-truth signal for the
//                  "ready to flip" decision.
//
//   • SANITY_FLOOR — obvious knowns. ~100% accuracy expected. If even
//                    these miss, the model is fundamentally broken AND
//                    the obscured results aren't trustworthy either.
//                    Advisory only — does NOT drive the flip decision
//                    on its own.
//
// IMPORTANT: keep `actual` honest. If a question's outcome is debatable,
// drop it from the calibration set — don't fudge.

interface CalibrationQuestion {
  id: string;
  category: "sports" | "politics" | "tech" | "celeb" | "macro";
  /** Which tranche this question belongs to — see the comment block
   *  above. `obscured` drives the flip decision; `sanity_floor` is
   *  advisory only. */
  tranche: "obscured" | "sanity_floor";
  question: string;
  /** What the LLM should answer at this knowledge cutoff. */
  cutoffDate: string;
  /** True = YES happened. False = NO happened. */
  actual: boolean;
  /** Optional short note for the report. */
  context?: string;
}

const QUESTIONS: CalibrationQuestion[] = [
  // ===========================================================================
  // TRANCHE: SANITY FLOOR (5 questions, advisory only)
  // ===========================================================================
  // Obvious knowns. Expected ~100% accuracy. If these miss, the model
  // can't even fact-lookup and the obscured tranche is untrustworthy.
  // ===========================================================================

  {
    id: "floor-trump-2024",
    category: "politics",
    tranche: "sanity_floor",
    question:
      "Did Donald Trump win the 2024 US Presidential election? Cutoff: November 6, 2024 (day after election).",
    cutoffDate: "2024-11-06",
    actual: true,
  },
  {
    id: "floor-argentina-wc-2022",
    category: "sports",
    tranche: "sanity_floor",
    question:
      "Did Argentina win the 2022 FIFA World Cup? Cutoff: December 19, 2022 (day after final).",
    cutoffDate: "2022-12-19",
    actual: true,
  },
  {
    id: "floor-vision-pro-2024",
    category: "tech",
    tranche: "sanity_floor",
    question:
      "Did Apple release the Vision Pro in the United States during 2024? Cutoff: March 1, 2024.",
    cutoffDate: "2024-03-01",
    actual: true,
    context: "Launched Feb 2, 2024.",
  },
  {
    id: "floor-btc-100k-2024",
    category: "macro",
    tranche: "sanity_floor",
    question:
      "Did Bitcoin trade above $100,000 USD at any point during 2024? Cutoff: January 1, 2025.",
    cutoffDate: "2025-01-01",
    actual: true,
    context: "Crossed $100k on December 5, 2024.",
  },
  {
    id: "floor-gpt5-2024",
    category: "tech",
    tranche: "sanity_floor",
    question:
      "Did OpenAI release a model publicly branded 'GPT-5' during 2024? Cutoff: January 1, 2025.",
    cutoffDate: "2025-01-01",
    actual: false,
    context: "GPT-5 did not launch in 2024; OpenAI released GPT-4o, o1, o3.",
  },

  // ===========================================================================
  // TRANCHE: PAST-BUT-OBSCURED (20 questions, drives the flip decision)
  // ===========================================================================
  // Compound conditions where the answer isn't on the first result page of
  // a naive web search. The LLM has to compose multiple facts or interpret
  // a specific threshold/metric.
  // ===========================================================================

  // -- Sports: outcome details, not headline winners --

  {
    id: "obs-wc-2022-final-penalties",
    category: "sports",
    tranche: "obscured",
    question:
      "Was the 2022 FIFA World Cup final decided by a penalty shoot-out (i.e. score level after extra time)? Cutoff: December 17, 2022 (one day before final).",
    cutoffDate: "2022-12-17",
    actual: true,
    context: "3-3 after extra time; Argentina won 4-2 on penalties.",
  },
  {
    id: "obs-superbowl-2024-margin",
    category: "sports",
    tranche: "obscured",
    question:
      "Was Super Bowl LVIII (2024) decided by a margin of MORE than 10 points? Cutoff: February 10, 2024 (one day before game).",
    cutoffDate: "2024-02-10",
    actual: false,
    context: "Chiefs 25, 49ers 22 — 3-point margin in OT, well under 10.",
  },
  {
    id: "obs-superbowl-2024-overtime",
    category: "sports",
    tranche: "obscured",
    question:
      "Did Super Bowl LVIII (2024) require overtime to determine a winner? Cutoff: February 10, 2024.",
    cutoffDate: "2024-02-10",
    actual: true,
  },
  {
    id: "obs-wimbledon-2024-straight-sets",
    category: "sports",
    tranche: "obscured",
    question:
      "Did the 2024 Wimbledon men's singles final end in straight sets (winner takes 3 sets to 0)? Cutoff: July 13, 2024 (one day before final).",
    cutoffDate: "2024-07-13",
    actual: true,
    context: "Alcaraz beat Djokovic 6-2, 6-2, 7-6 — 3 sets to 0.",
  },
  {
    id: "obs-cl-2024-three-plus-goals",
    category: "sports",
    tranche: "obscured",
    question:
      "Did the 2024 UEFA Champions League final feature 3 or more total goals scored across both teams in regulation? Cutoff: June 1, 2024.",
    cutoffDate: "2024-06-01",
    actual: false,
    context: "Real Madrid 2, Dortmund 0 — 2 total goals.",
  },
  {
    id: "obs-euro-2024-one-goal-margin",
    category: "sports",
    tranche: "obscured",
    question:
      "Did the 2024 UEFA Euro final end with a one-goal margin in regulation (not requiring extra time or penalties)? Cutoff: July 14, 2024.",
    cutoffDate: "2024-07-14",
    actual: true,
    context: "Spain 2, England 1 — one-goal margin in regulation.",
  },
  {
    id: "obs-f1-2024-margin",
    category: "sports",
    tranche: "obscured",
    question:
      "Did the winner of the 2024 F1 Drivers' Championship win by a points margin of 50 or more over the runner-up? Cutoff: November 1, 2024.",
    cutoffDate: "2024-11-01",
    actual: true,
    context: "Verstappen finished 437 vs Norris 374 — 63-point margin.",
  },
  {
    id: "obs-nba-2024-sweep",
    category: "sports",
    tranche: "obscured",
    question:
      "Were the 2024 NBA Finals (Celtics vs Mavericks) decided in 4 or 5 games (i.e. NOT going to 6 or 7)? Cutoff: June 5, 2024.",
    cutoffDate: "2024-06-05",
    actual: true,
    context: "Celtics won 4-1 in 5 games.",
  },

  // -- Politics: thresholds and margins, not winners --

  {
    id: "obs-trump-2024-ec-margin",
    category: "politics",
    tranche: "obscured",
    question:
      "Did Donald Trump win the 2024 US Presidential election with MORE than 320 electoral votes? Cutoff: November 5, 2024 (election day).",
    cutoffDate: "2024-11-05",
    actual: false,
    context: "Trump finished with 312 EVs to Harris's 226 — below 320.",
  },
  {
    id: "obs-uk-labour-2024-seats",
    category: "politics",
    tranche: "obscured",
    question:
      "Did the Labour Party win 400 or more seats in the 2024 UK general election? Cutoff: July 4, 2024 (election day).",
    cutoffDate: "2024-07-04",
    actual: true,
    context: "Labour won 411 seats out of 650.",
  },
  {
    id: "obs-france-snap-2024-rn-first",
    category: "politics",
    tranche: "obscured",
    question:
      "Did the National Rally (RN) finish FIRST in seat count in the 2024 French snap legislative elections? Cutoff: July 7, 2024.",
    cutoffDate: "2024-07-07",
    actual: false,
    context: "New Popular Front won most seats; RN finished third despite leading the first round.",
  },
  {
    id: "obs-milei-2023-margin",
    category: "politics",
    tranche: "obscured",
    question:
      "Did Javier Milei win the 2023 Argentine presidential runoff with MORE than 60% of the vote? Cutoff: November 19, 2023.",
    cutoffDate: "2023-11-19",
    actual: false,
    context: "Won 55.65% to 44.35% — below 60%.",
  },

  // -- Tech: specific facets, not the headline launch --

  {
    id: "obs-vision-pro-price",
    category: "tech",
    tranche: "obscured",
    question:
      "Did the Apple Vision Pro launch in the US with a base retail price of $3,500 or more? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: false,
    context: "Launched at $3,499 — one dollar under $3,500.",
  },
  {
    id: "obs-openai-board-majority-intact",
    category: "tech",
    tranche: "obscured",
    question:
      "Was the OpenAI board that fired Sam Altman on November 17, 2023 still majority-intact one month later (i.e. on December 17, 2023, did a majority of the November 16 board members still hold their seats)? Cutoff: November 18, 2023.",
    cutoffDate: "2023-11-18",
    actual: false,
    context:
      "Board was reconstituted by Nov 22, 2023 — only Adam D'Angelo remained from the firing-day board (1 of 6 = 17%). The headline 'Altman returned' is searchable; the specific board-composition fact is not.",
  },
  {
    id: "obs-openai-o1-before-gpt5",
    category: "tech",
    tranche: "obscured",
    question:
      "By end of 2024, had OpenAI released a model branded 'o1' to the public BEFORE releasing any model branded 'GPT-5'? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: true,
    context: "o1-preview launched September 2024; GPT-5 did not launch in 2024.",
  },

  // -- Celeb: specific knowable details about the headline event --

  {
    id: "obs-not-like-us-billboard-1",
    category: "celeb",
    tranche: "obscured",
    question:
      "Did any Kendrick Lamar diss track aimed at Drake reach #1 on the Billboard Hot 100 during 2024? Cutoff: April 30, 2024 (early in feud).",
    cutoffDate: "2024-04-30",
    actual: true,
    context: "'Not Like Us' debuted at #1 on Billboard Hot 100 in May 2024.",
  },
  {
    id: "obs-diddy-charges-before-oct",
    category: "celeb",
    tranche: "obscured",
    question:
      "Did Sean 'Diddy' Combs face federal indictment BEFORE October 1, 2024? Cutoff: April 1, 2024.",
    cutoffDate: "2024-04-01",
    actual: true,
    context: "Arrested and indicted September 16, 2024.",
  },
  {
    id: "obs-kanye-2024-three-albums",
    category: "celeb",
    tranche: "obscured",
    question:
      "Did Kanye West release THREE or more studio albums during 2024? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: false,
    context: "Released Vultures 1 (Feb 2024) and Vultures 2 (Aug 2024) — only 2.",
  },
  {
    id: "obs-jlo-divorce-before-sept",
    category: "celeb",
    tranche: "obscured",
    question:
      "Did Jennifer Lopez file divorce papers against Ben Affleck BEFORE September 1, 2024? Cutoff: April 1, 2024.",
    cutoffDate: "2024-04-01",
    actual: true,
    context: "Filed August 20, 2024.",
  },

  // -- Macro: specific thresholds, not generic 'did X happen' --

  {
    id: "obs-btc-100k-before-dec",
    category: "macro",
    tranche: "obscured",
    question:
      "Did Bitcoin first close above $100,000 USD BEFORE December 1, 2024? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: false,
    context: "First crossed $100k on December 5, 2024 — narrowly after Dec 1.",
  },
  {
    id: "obs-fed-cut-125bps-or-more",
    category: "macro",
    tranche: "obscured",
    question:
      "Did the US Federal Reserve cut interest rates by MORE than 125 basis points cumulatively during 2024? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: false,
    context: "Cut 100bps total (Sept 50, Nov 25, Dec 25) — below 125.",
  },
  {
    id: "obs-tesla-75pct-cap",
    category: "macro",
    tranche: "obscured",
    question:
      "Did Tesla (TSLA) close 2024 below 75% above its January 1, 2024 closing price (i.e. multiplier under 1.75x)? Cutoff: January 1, 2024.",
    cutoffDate: "2024-01-01",
    actual: true,
    context: "Closed 2024 ~+62% YTD; 1.62x is below 1.75x.",
  },
];

// ---------------------------------------------------------------------------
// LLM call — neutral analyst prompt (NOT a persona-bound copy of the
// production world-market prompt). The point of calibration is to measure
// the LLM's own probability accuracy, not how a single persona slants it.
// If THIS layer is well-calibrated, the persona-band P&L tile (item 6 of
// the post-launch hardening plan) tells us whether the production prompt
// adds or removes value on top.
// ---------------------------------------------------------------------------

// Default to the same model the production world-markets path uses, so
// the calibration measures the actual production behaviour. Falls back
// to `AI_DEFAULT_MODEL` then `gpt-5.4` to mirror `getAiModel('worldMarkets')`
// in `server/config/ai-models.ts`. Override with `WORLD_CALIBRATION_MODEL`
// when comparing alternative models against the same question set.
const MODEL =
  process.env.WORLD_CALIBRATION_MODEL ??
  process.env.WORLD_MARKETS_MODEL ??
  process.env.AI_DEFAULT_MODEL ??
  "gpt-5.4";
const API_TIMEOUT_MS = 60_000;
// Matches the production cap in `server/agents/worldMarketEngine.ts`.
// Smaller caps risk truncating valid JSON outputs on longer reasoning.
const MAX_OUTPUT_TOKENS = 400;

function buildCalibrationPrompt(q: CalibrationQuestion): {
  instructions: string;
  input: string;
} {
  const instructions = `You are a calibration evaluator for a prediction market. Your task is to estimate the probability that a YES/NO question will resolve YES, AS IF you were a neutral analyst BEFORE the resolution date.

Guidelines:
- Use web search to find relevant news, market odds, polls, expert analysis.
- IMPORTANT: anchor your estimate to information available AT THE CUTOFF DATE provided in the question. Do not let post-cutoff knowledge inflate your confidence.
- Express your final estimate as a probability between 0.01 and 0.99 (never 0 or 1 — you are not omniscient).
- Be honest about uncertainty. If a question is genuinely 50/50 at the cutoff, say 0.50.
- Avoid hindsight bias. Many questions in this evaluation have known answers, but I want your estimate as the question would have been answered at the cutoff date, not now.

You MUST respond with a single JSON object and nothing else:
{
  "probabilityYes": <number 0.01-0.99>,
  "briefReasoning": "<one sentence, anchored to cutoff-date information>"
}`;
  const input = `QUESTION: ${q.question}
CATEGORY: ${q.category}
CUTOFF DATE: ${q.cutoffDate}

Estimate the probability of YES.`;
  return { instructions, input };
}

interface LlmResult {
  questionId: string;
  probabilityYes: number;
  briefReasoning: string;
  rawText?: string;
  error?: string;
}

function getOpenAIClient(): InstanceType<typeof OpenAI> {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY / AI_INTEGRATIONS_OPENAI_API_KEY in env. Add it to .env or export it.",
    );
  }
  return new OpenAI({ apiKey });
}

function extractOutputText(response: any): string | null {
  if (response.output_text) return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part.type === "output_text" || part.type === "text") && part.text) {
          return part.text;
        }
      }
    }
  }
  for (const item of response.output) {
    if (item.type === "text" && item.text) return item.text;
  }
  return null;
}

async function callLlm(q: CalibrationQuestion): Promise<LlmResult> {
  const { instructions, input } = buildCalibrationPrompt(q);
  const client = getOpenAIClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await client.responses.create(
      {
        model: MODEL,
        tools: [{ type: "web_search" as any }],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions,
        input,
      } as any,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const raw = extractOutputText(response);
    if (!raw) {
      return {
        questionId: q.id,
        probabilityYes: NaN,
        briefReasoning: "",
        error: "empty_response",
      };
    }

    let jsonText = raw.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        questionId: q.id,
        probabilityYes: NaN,
        briefReasoning: "",
        rawText: raw,
        error: "parse_failed",
      };
    }

    const p = Number(parsed.probabilityYes);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) {
      return {
        questionId: q.id,
        probabilityYes: NaN,
        briefReasoning: String(parsed.briefReasoning ?? ""),
        rawText: raw,
        error: `invalid_probability: ${parsed.probabilityYes}`,
      };
    }

    return {
      questionId: q.id,
      probabilityYes: p,
      briefReasoning: String(parsed.briefReasoning ?? ""),
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      questionId: q.id,
      probabilityYes: NaN,
      briefReasoning: "",
      error: `api_error: ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Cache (so re-running for analysis doesn't re-hit the API)
// ---------------------------------------------------------------------------
function loadCache(): Record<string, LlmResult> {
  if (!USE_CACHE || !existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as Record<string, LlmResult>;
  } catch {
    return {};
  }
}

function saveCache(results: Record<string, LlmResult>): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// Bucketing + calibration math
// ---------------------------------------------------------------------------
const BANDS: Array<[number, number, string]> = [
  [0.0, 0.1, "0.00-0.10"],
  [0.1, 0.2, "0.10-0.20"],
  [0.2, 0.3, "0.20-0.30"],
  [0.3, 0.4, "0.30-0.40"],
  [0.4, 0.5, "0.40-0.50"],
  [0.5, 0.6, "0.50-0.60"],
  [0.6, 0.7, "0.60-0.70"],
  [0.7, 0.8, "0.70-0.80"],
  [0.8, 0.9, "0.80-0.90"],
  [0.9, 1.0, "0.90-1.00"],
];

interface BandStats {
  band: string;
  count: number;
  avgProb: number;
  yesRate: number;
  calibrationError: number;
  /** Status against the warn threshold (0.10 absolute calibration error). */
  flag: "ok" | "warn" | "low_sample";
}

/**
 * Maximum acceptable absolute calibration error per probability band
 * in the OBSCURED tranche. Relaxed from the original 0.10 to 0.15
 * because a 20-question set across 5+ bands is genuinely small-sample:
 * the goal is "rule out gross miscalibration" not "prove perfect
 * calibration." If a band shows > 0.15 error with n >= MIN_BAND_SAMPLE
 * we surface it and refuse to flip the flag.
 */
const CALIBRATION_WARN_THRESHOLD = 0.15;

/**
 * Minimum sample count per band before its calibration error is treated
 * as a real signal. Below this we report "n<5" and skip the band from
 * the verdict — small-sample noise would otherwise drive false alarms.
 */
const MIN_BAND_SAMPLE = 5;

/**
 * Minimum accuracy (correct YES/NO call at threshold 0.5) the SANITY
 * FLOOR tranche must show. Below this the model can't even fact-lookup
 * and the obscured tranche's results are untrustworthy — we refuse to
 * flip the flag regardless of obscured-tranche calibration.
 */
const SANITY_FLOOR_MIN_ACCURACY = 0.9;

function bucketResults(
  results: Array<{ probabilityYes: number; actual: boolean }>,
): BandStats[] {
  return BANDS.map(([lo, hi, label]) => {
    const inBand = results.filter(
      (r) =>
        Number.isFinite(r.probabilityYes) &&
        r.probabilityYes >= lo &&
        r.probabilityYes < (hi === 1.0 ? 1.0001 : hi),
    );
    const count = inBand.length;
    if (count === 0) {
      return {
        band: label,
        count: 0,
        avgProb: NaN,
        yesRate: NaN,
        calibrationError: NaN,
        flag: "low_sample",
      } as BandStats;
    }
    const avgProb = inBand.reduce((s, r) => s + r.probabilityYes, 0) / count;
    const yesRate = inBand.filter((r) => r.actual).length / count;
    const calibrationError = yesRate - avgProb;
    const flag: BandStats["flag"] =
      count < MIN_BAND_SAMPLE
        ? "low_sample"
        : Math.abs(calibrationError) > CALIBRATION_WARN_THRESHOLD
        ? "warn"
        : "ok";
    return { band: label, count, avgProb, yesRate, calibrationError, flag };
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function renderStdoutTable(stats: BandStats[]): string {
  const header =
    "Band       | N  | Avg LLM prob | Actual YES rate | Calibration error | Flag";
  const sep = "-".repeat(header.length);
  const rows = stats.map((s) => {
    const flagLabel =
      s.flag === "ok" ? "ok" : s.flag === "warn" ? "WARN" : "n<5";
    return `${s.band.padEnd(10)} | ${String(s.count).padStart(2)} | ${fmt(s.avgProb).padStart(12)} | ${fmt(s.yesRate).padStart(15)} | ${(Number.isFinite(s.calibrationError) ? (s.calibrationError >= 0 ? "+" : "") + fmt(s.calibrationError) : "—").padStart(17)} | ${flagLabel}`;
  });
  return [header, sep, ...rows].join("\n");
}

interface FloorStats {
  /** Sample size in the floor tranche. */
  count: number;
  /** Number with `probabilityYes >= 0.5` whose actual was YES OR
   *  `probabilityYes < 0.5` whose actual was NO. */
  correct: number;
  /** correct / count, NaN when count == 0. */
  accuracy: number;
  /** True iff `accuracy >= SANITY_FLOOR_MIN_ACCURACY`. */
  passes: boolean;
}

function computeFloorStats(
  rows: Array<{ probabilityYes: number; actual: boolean }>,
): FloorStats {
  const count = rows.length;
  if (count === 0) {
    return { count: 0, correct: 0, accuracy: NaN, passes: false };
  }
  const correct = rows.filter(
    (r) =>
      Number.isFinite(r.probabilityYes) &&
      (r.probabilityYes >= 0.5 ? r.actual : !r.actual),
  ).length;
  const accuracy = correct / count;
  return {
    count,
    correct,
    accuracy,
    passes: accuracy >= SANITY_FLOOR_MIN_ACCURACY,
  };
}

function renderMarkdownReport(input: {
  ranAt: string;
  model: string;
  totalQuestions: number;
  failed: number;
  floorStats: FloorStats;
  obscuredStats: BandStats[];
  perQuestion: Array<{
    q: CalibrationQuestion;
    result: LlmResult;
  }>;
}): string {
  const { ranAt, model, totalQuestions, failed, floorStats, obscuredStats, perQuestion } = input;
  const lines: string[] = [];
  lines.push(`# World Market LLM Calibration Report`);
  lines.push(``);
  lines.push(`**Ran at:** ${ranAt}`);
  lines.push(`**Model:** \`${model}\``);
  lines.push(`**Sample size:** ${totalQuestions} questions (${failed} failed LLM calls)`);
  lines.push(``);
  lines.push(`## Decision rule`);
  lines.push(``);
  lines.push(
    `Re-enable \`WORLD_MARKETS_LLM_ENABLED\` only when BOTH:`,
  );
  lines.push(``);
  lines.push(
    `1. **Sanity floor tranche** accuracy >= ${(SANITY_FLOOR_MIN_ACCURACY * 100).toFixed(0)}% (the model can find facts).`,
  );
  lines.push(
    `2. **Past-but-obscured tranche** absolute calibration error < ` +
      `\`${CALIBRATION_WARN_THRESHOLD.toFixed(2)}\` across every band ` +
      `with n >= ${MIN_BAND_SAMPLE}. Any band breaching this means agents ` +
      `trading on that probability range will systematically over- or ` +
      `under-bid the side.`,
  );
  lines.push(``);
  lines.push(
    `Why the split: known-outcome questions let the LLM web-search the ` +
      `answer directly. Compound conditions in the obscured tranche force ` +
      `the model to estimate a probability rather than report a fact. The ` +
      `obscured tranche is the source of truth; the floor is a fundamental-` +
      `broken-ness check.`,
  );
  lines.push(``);
  lines.push(`## Sanity floor tranche (advisory)`);
  lines.push(``);
  lines.push(
    `${floorStats.correct} of ${floorStats.count} correct ` +
      `(${fmt(floorStats.accuracy * 100, 1)}% accuracy). ` +
      `Threshold: >= ${(SANITY_FLOOR_MIN_ACCURACY * 100).toFixed(0)}%. ` +
      `**${floorStats.passes ? "PASS" : "FAIL"}**`,
  );
  lines.push(``);
  lines.push(`## Past-but-obscured tranche (primary signal)`);
  lines.push(``);
  lines.push(`| Band | N | Avg LLM prob | Actual YES rate | Calibration error | Flag |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const s of obscuredStats) {
    const flagLabel =
      s.flag === "ok" ? "ok" : s.flag === "warn" ? "**WARN**" : "n<5";
    const errStr = Number.isFinite(s.calibrationError)
      ? (s.calibrationError >= 0 ? "+" : "") + fmt(s.calibrationError)
      : "—";
    lines.push(
      `| ${s.band} | ${s.count} | ${fmt(s.avgProb)} | ${fmt(s.yesRate)} | ${errStr} | ${flagLabel} |`,
    );
  }
  lines.push(``);
  const worstBand = obscuredStats
    .filter((s) => s.flag !== "low_sample")
    .reduce<BandStats | null>(
      (acc, s) =>
        Math.abs(s.calibrationError) > Math.abs(acc?.calibrationError ?? 0)
          ? s
          : acc,
      null,
    );
  if (worstBand) {
    lines.push(
      `**Worst-calibrated band (obscured):** ${worstBand.band} (error ${(worstBand.calibrationError >= 0 ? "+" : "") + fmt(worstBand.calibrationError)})`,
    );
    lines.push(``);
  }
  lines.push(`## Per-question results`);
  lines.push(``);
  lines.push(`| Tranche | Question | Category | LLM prob | Actual | Reasoning |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const { q, result } of perQuestion) {
    const probCell = result.error
      ? `_${result.error}_`
      : fmt(result.probabilityYes);
    const actualCell = q.actual ? "YES" : "no";
    const reason = (result.briefReasoning ?? "").replace(/\|/g, "\\|").slice(0, 200);
    lines.push(
      `| ${q.tranche} | ${q.question.slice(0, 100)} | ${q.category} | ${probCell} | ${actualCell} | ${reason} |`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`[WorldCalibration] Model: ${MODEL}`);
  console.log(
    `[WorldCalibration] Sample size: ${QUESTIONS.length} questions; cache: ${USE_CACHE ? "ON" : "OFF"}`,
  );

  const cache = loadCache();
  const perQuestion: Array<{ q: CalibrationQuestion; result: LlmResult }> = [];

  let apiCalls = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const cached = USE_CACHE ? cache[q.id] : undefined;
    let result: LlmResult;
    if (cached && Number.isFinite(cached.probabilityYes)) {
      result = cached;
      console.log(
        `[${i + 1}/${QUESTIONS.length}] ${q.id} -> ${fmt(result.probabilityYes)} (cached)`,
      );
    } else {
      apiCalls += 1;
      console.log(`[${i + 1}/${QUESTIONS.length}] ${q.id} -> calling LLM ...`);
      result = await callLlm(q);
      cache[q.id] = result;
      saveCache(cache);
      const tag = result.error
        ? `ERR ${result.error}`
        : fmt(result.probabilityYes);
      console.log(
        `[${i + 1}/${QUESTIONS.length}] ${q.id} -> ${tag}`,
      );
    }
    perQuestion.push({ q, result });
  }

  const successful = perQuestion.filter((p) =>
    Number.isFinite(p.result.probabilityYes),
  );
  const failed = perQuestion.length - successful.length;

  // Split by tranche. The sanity floor is a binary accuracy check; the
  // obscured tranche is the real calibration signal.
  const floorRows = successful
    .filter((p) => p.q.tranche === "sanity_floor")
    .map((p) => ({
      probabilityYes: p.result.probabilityYes,
      actual: p.q.actual,
    }));
  const obscuredRows = successful
    .filter((p) => p.q.tranche === "obscured")
    .map((p) => ({
      probabilityYes: p.result.probabilityYes,
      actual: p.q.actual,
    }));

  const floorStats = computeFloorStats(floorRows);
  const obscuredStats = bucketResults(obscuredRows);

  console.log("");
  console.log(`API calls this run: ${apiCalls}`);
  console.log(`Successful: ${successful.length}; failed: ${failed}`);
  console.log("");
  console.log(
    `=== Sanity floor tranche (${floorStats.count} questions) ===`,
  );
  console.log(
    `Accuracy: ${fmt(floorStats.accuracy * 100, 1)}% (${floorStats.correct}/${floorStats.count})  threshold: >= ${(SANITY_FLOOR_MIN_ACCURACY * 100).toFixed(0)}%   ${floorStats.passes ? "PASS" : "FAIL"}`,
  );
  console.log("");
  console.log(
    `=== Past-but-obscured tranche (${obscuredRows.length} questions) ===`,
  );
  console.log(renderStdoutTable(obscuredStats));
  console.log("");

  const obscuredWarn = obscuredStats.some((s) => s.flag === "warn");
  const allLowSample = obscuredStats.every((s) => s.flag === "low_sample");
  const floorPass = floorStats.passes;

  let exitCode = 0;
  if (!floorPass) {
    console.log(
      `VERDICT: sanity floor failed (${fmt(floorStats.accuracy * 100, 1)}% < ${(SANITY_FLOOR_MIN_ACCURACY * 100).toFixed(0)}%). ` +
        `Model can't reliably look up known facts — obscured tranche results are NOT trustworthy. ` +
        `DO NOT flip WORLD_MARKETS_LLM_ENABLED.`,
    );
    exitCode = 1;
  } else if (obscuredWarn) {
    console.log(
      `VERDICT: obscured tranche calibration error exceeds ${CALIBRATION_WARN_THRESHOLD.toFixed(2)} in at least one band with n >= ${MIN_BAND_SAMPLE}. ` +
        `DO NOT flip WORLD_MARKETS_LLM_ENABLED until the offending band is investigated.`,
    );
    exitCode = 1;
  } else if (allLowSample) {
    console.log(
      `VERDICT: every band in the obscured tranche has fewer than ${MIN_BAND_SAMPLE} samples. ` +
        `Add more questions before drawing conclusions.`,
    );
    // Not a failure per se — just inconclusive. Exit 0 so this can run
    // in CI without false alarms during set-rebuilds.
  } else {
    console.log(
      `VERDICT: floor PASSES (${fmt(floorStats.accuracy * 100, 1)}%) AND every obscured band with n >= ${MIN_BAND_SAMPLE} is within ${CALIBRATION_WARN_THRESHOLD.toFixed(2)} calibration error. ` +
        `Calibration looks acceptable; flag flip is justified.`,
    );
  }

  const md = renderMarkdownReport({
    ranAt: new Date().toISOString(),
    model: MODEL,
    totalQuestions: QUESTIONS.length,
    failed,
    floorStats,
    obscuredStats,
    perQuestion,
  });
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md);
  console.log("");
  console.log(`Wrote markdown report -> ${OUT_PATH}`);

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[WorldCalibration] Fatal:", err);
  process.exit(2);
});
