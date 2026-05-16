/**
 * Phase 3 AMM smoke runner.
 *
 * Drives the full LMSR lifecycle against a deployed instance:
 *   1. Sign in alice (admin) and bob (admin or user) via Supabase Auth.
 *   2. Alice POST /api/admin/amm/smoke-create-market → fresh draft AMM market.
 *   3. Alice POST /api/markets/:id/buy on entry A.
 *   4. Bob   POST /api/markets/:id/buy on entry B.
 *   5. GET   /api/markets/:id → confirm prices have moved.
 *   6. Alice POST /api/markets/:id/sell on entry A (partial exit).
 *   7. GET   /api/markets/:id/amm-position for alice.
 *   8. Alice POST /api/admin/markets/:id/amm-resolve → winner = A.
 *   9. Print invariant report (alice profit + bob loss + house P&L = 0).
 *
 * Reads:
 *   - .env       (Supabase URL + anon key — already used by the dev server)
 *   - .env.smoke (smoke-only credentials, gitignored — copy from
 *                 .env.smoke.example)
 *
 * Run with:
 *   npm run amm:smoke
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Lightweight .env loader (avoids adding a `dotenv` dep just for this script).
// ---------------------------------------------------------------------------
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.smoke"));

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `[amm-smoke] Missing env var: ${name}. Copy .env.smoke.example to .env.smoke and fill it in.`,
    );
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const BASE_URL = requireEnv("SMOKE_BASE_URL").replace(/\/$/, "");
const ALICE_EMAIL = requireEnv("SMOKE_ALICE_EMAIL");
const ALICE_PASSWORD = requireEnv("SMOKE_ALICE_PASSWORD");
const BOB_EMAIL = requireEnv("SMOKE_BOB_EMAIL");
const BOB_PASSWORD = requireEnv("SMOKE_BOB_PASSWORD");
const NUM_OUTCOMES = Number(process.env.SMOKE_NUM_OUTCOMES ?? 3);
const TARGET_MAX_LOSS = Number(process.env.SMOKE_TARGET_MAX_LOSS ?? 5000);

// ---------------------------------------------------------------------------
// Tiny logging helpers
// ---------------------------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function step(n: number, title: string): void {
  console.log(`\n${cyan(bold(`[${n}] ${title}`))}`);
}
function info(label: string, value: unknown): void {
  console.log(`    ${dim(label)} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
}

// ---------------------------------------------------------------------------
// Supabase auth — sign in each user, return their access token + uid.
// ---------------------------------------------------------------------------
interface SignedInUser {
  email: string;
  userId: string;
  accessToken: string;
}

async function signIn(client: SupabaseClient, email: string, password: string): Promise<SignedInUser> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  }
  return {
    email,
    userId: data.user.id,
    accessToken: data.session.access_token,
  };
}

// ---------------------------------------------------------------------------
// Authenticated fetch wrapper — every smoke call goes through this.
// ---------------------------------------------------------------------------
async function api<T = any>(
  user: SignedInUser,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${json ? JSON.stringify(json) : text || res.statusText}`,
    );
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(bold(`\nAMM Phase 3 smoke runner`));
  info("baseUrl", BASE_URL);
  info("supabase", SUPABASE_URL);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  step(1, "Sign in alice + bob");
  const alice = await signIn(supabase, ALICE_EMAIL, ALICE_PASSWORD);
  const bob = await signIn(supabase, BOB_EMAIL, BOB_PASSWORD);
  info("alice.userId", alice.userId);
  info("bob.userId", bob.userId);
  if (alice.userId === bob.userId) {
    throw new Error("Alice and Bob must be different users for a meaningful smoke test.");
  }

  step(2, "Alice creates a draft AMM smoke market");
  const created = await api<{
    ok: true;
    marketId: string;
    slug: string;
    numOutcomes: number;
    entries: Array<{ id: string; label: string; displayOrder: number }>;
    liquidityB: number;
    houseSeedAmount: number;
    houseBalanceAfter: number;
  }>(alice, "POST", "/api/admin/amm/smoke-create-market", {
    numOutcomes: NUM_OUTCOMES,
    targetMaxLoss: TARGET_MAX_LOSS,
  });
  const marketId = created.marketId;
  const entryA = created.entries[0];
  const entryB = created.entries[1];
  info("marketId", marketId);
  info("liquidityB", created.liquidityB.toFixed(2));
  info("houseSeed", created.houseSeedAmount);
  info("houseBalanceAfter", created.houseBalanceAfter);
  info(
    "entries",
    created.entries.map((e) => `${e.label}=${e.id.slice(0, 8)}`).join("  "),
  );

  step(3, "Initial market state (uniform 1/N prices expected)");
  const stateBefore = await api<any>(alice, "GET", `/api/markets/${marketId}`);
  info("prices", stateBefore.ammState.prices);

  step(4, `Alice buys 100 credits of "${entryA.label}"`);
  const buyAlice = await api<any>(alice, "POST", `/api/markets/${marketId}/buy`, {
    entryId: entryA.id,
    creditBudget: 100,
  });
  info("shares", buyAlice.sharesPurchased.toFixed(4));
  info("charged", buyAlice.chargeCredits);
  info("avgPrice", buyAlice.pricePerShareAvg.toFixed(4));
  info("aliceBalance", buyAlice.userBalanceAfter);
  info("newPrices", buyAlice.newPrices);

  step(5, `Bob buys 50 credits of "${entryB.label}"`);
  const buyBob = await api<any>(bob, "POST", `/api/markets/${marketId}/buy`, {
    entryId: entryB.id,
    creditBudget: 50,
  });
  info("shares", buyBob.sharesPurchased.toFixed(4));
  info("charged", buyBob.chargeCredits);
  info("avgPrice", buyBob.pricePerShareAvg.toFixed(4));
  info("bobBalance", buyBob.userBalanceAfter);
  info("newPrices", buyBob.newPrices);

  step(6, "Market state after the two buys");
  const stateAfterBuys = await api<any>(alice, "GET", `/api/markets/${marketId}`);
  info("prices", stateAfterBuys.ammState.prices);
  info("totalUserCreditsIn", stateAfterBuys.ammState.totalUserCreditsIn);

  // Sell ~25% of alice's position to exercise the sell path. We use a
  // round-down of (alice's shares) / 4 so it remains comfortably within
  // her holdings even with float drift.
  const sellShares = Math.floor((buyAlice.sharesPurchased / 4) * 100) / 100;
  step(7, `Alice sells ${sellShares} shares of "${entryA.label}"`);
  const sellAlice = await api<any>(alice, "POST", `/api/markets/${marketId}/sell`, {
    entryId: entryA.id,
    shares: sellShares,
  });
  info("proceeds", sellAlice.proceeds);
  info("avgPrice", sellAlice.pricePerShareAvg.toFixed(4));
  info("aliceBalance", sellAlice.userBalanceAfter);
  info("remainingShares", sellAlice.remainingShares.toFixed(4));
  info("newPrices", sellAlice.newPrices);

  step(8, "Alice's AMM position pre-settlement");
  const positionBefore = await api<any>(alice, "GET", `/api/markets/${marketId}/amm-position`);
  for (const p of positionBefore.positions) {
    info(p.entryLabel, {
      netShares: p.netShares.toFixed(4),
      avgEntry: p.avgEntryPrice.toFixed(4),
      currentPrice: p.currentPrice.toFixed(4),
      currentValue: p.currentValue.toFixed(2),
      netCreditsIn: p.netCreditsIn,
    });
  }

  step(9, `Resolve the market: winner = "${entryA.label}"`);
  const resolved = await api<any>(alice, "POST", `/api/admin/markets/${marketId}/amm-resolve`, {
    winnerEntryId: entryA.id,
  });
  info("payoutLiability", resolved.payoutLiability);
  info("creditedToHouse", resolved.creditedToHouse);
  info("settledUserCount", resolved.settledUserCount);

  // ---------------------------------------------------------------------
  // Invariant report — alice profit + bob loss + house P&L should net
  // to ~0 (modulo at most a few credits of ceil/floor rounding).
  // ---------------------------------------------------------------------
  step(10, "Invariant report");

  const aliceSpent = buyAlice.chargeCredits;          // bought
  const aliceReceivedSell = sellAlice.proceeds;       // partial exit
  // Alice's payout from settlement is the share of payoutLiability we
  // credited to her. With only one winning user (alice), the entire
  // payoutLiability is hers.
  const alicePayout = resolved.payoutLiability;
  const aliceNet = alicePayout + aliceReceivedSell - aliceSpent;

  const bobSpent = buyBob.chargeCredits;
  const bobNet = -bobSpent;                           // bob got nothing back

  const houseSeed = created.houseSeedAmount;
  const houseRecovered = resolved.creditedToHouse;
  const houseNet = houseRecovered - houseSeed;

  const totalNet = aliceNet + bobNet + houseNet;

  info("alice.spent", aliceSpent);
  info("alice.sellProceeds", aliceReceivedSell);
  info("alice.settlePayout", alicePayout);
  info("alice.net", aliceNet);
  info("bob.spent", bobSpent);
  info("bob.net", bobNet);
  info("house.seedPaid", houseSeed);
  info("house.recovered", houseRecovered);
  info("house.net", houseNet);
  info("sum", totalNet);

  console.log();
  if (Math.abs(totalNet) <= 5) {
    console.log(green(bold(`✓ Zero-sum invariant holds (sum = ${totalNet}, within 5-credit rounding tolerance).`)));
  } else {
    console.log(red(bold(`✗ Zero-sum invariant FAILED: sum = ${totalNet} credits off.`)));
    process.exitCode = 1;
  }

  if (alicePayout > aliceSpent - aliceReceivedSell) {
    console.log(green(`✓ Alice profited: paid ${aliceSpent - aliceReceivedSell} net, received ${alicePayout} at settlement.`));
  } else {
    console.log(yellow(`! Alice broke even or lost — check market sizing.`));
  }
  if (bobNet < 0) {
    console.log(green(`✓ Bob lost ${Math.abs(bobNet)} credits as expected (backed the losing entry).`));
  }
  // LMSR's bounded loss ceiling: b * ln(N). The house can NEVER lose
  // more than this (which equals the seed by construction in Phase 2).
  // A negative house P&L is normal LMSR behaviour, not a bug — it
  // just means more credits flowed to the winning side than the
  // losing side put in. Two-sided markets typically net house
  // positive thanks to ceil/floor rounding + LMSR spread.
  const numOutcomes = created.numOutcomes;
  const boundedLoss = Math.ceil(created.liquidityB * Math.log(numOutcomes));
  if (houseNet >= 0) {
    console.log(
      green(
        `✓ House P&L: +${houseNet} credits (within bounded risk envelope ±${boundedLoss}). LMSR spread + rounding.`,
      ),
    );
  } else if (Math.abs(houseNet) <= boundedLoss) {
    console.log(
      cyan(
        `ⓘ House P&L: ${houseNet} credits — inside the bounded LMSR risk envelope (±${boundedLoss} = b·ln(N)).\n` +
          `    Expected for one-sided markets where the dominant side wins. Two-sided trading + ceil/floor crumbs typically pull house net positive in production.`,
      ),
    );
  } else {
    console.log(
      red(
        `✗ House P&L: ${houseNet} credits — EXCEEDS the bounded loss ceiling of ±${boundedLoss}. This shouldn't be possible if seedB / pricing math is correct. Investigate.`,
      ),
    );
    process.exitCode = 1;
  }

  console.log(dim(`\nMarket id: ${marketId} (slug=${created.slug}). Safe to leave; flagged with the "amm-smoke" tag.`));

  // ===================================================================
  // Phase B — live market sweep
  // ===================================================================
  // Pick one OPEN live AMM market per type (h2h / updown / gainer) and
  // run a small buy + ~25% sell against each. This exercises the AMM
  // bet routes that humans actually hit in production (vs. Phase A's
  // synthetic draft market via the admin smoke endpoint).
  //
  // Invariants per market:
  //   * buy charges credits and bumps prices
  //   * position endpoint returns the right netShares
  //   * sell returns proceeds < buy spend (LMSR spread)
  //   * XP is awarded on the buy (via the new amm-bet-hooks helper)
  // ===================================================================

  console.log(`\n${cyan(bold("=== Phase B — live market sweep ==="))}`);

  const liveMarketTypes: Array<{
    apiType: "h2h" | "updown" | "gainer";
    label: string;
    betPath: (id: string) => string;
  }> = [
    {
      apiType: "h2h",
      label: "H2H",
      betPath: (id) => `/api/native-markets/${id}/bet`,
    },
    {
      apiType: "updown",
      label: "UpDown",
      betPath: (id) => `/api/native-markets/updown/${id}/bet`,
    },
    {
      apiType: "gainer",
      label: "Race",
      betPath: (id) => `/api/native-markets/${id}/bet`,
    },
  ];

  let phaseBFailures = 0;
  for (const mt of liveMarketTypes) {
    step(11, `${mt.label} — pick latest OPEN live market`);
    let picked: any = null;
    try {
      picked = await api<any>(
        alice,
        "GET",
        `/api/admin/amm/smoke-pick-market?marketType=${mt.apiType}`,
      );
    } catch (err: any) {
      console.log(yellow(`    ! No ${mt.label} market available to smoke (${err?.message ?? err}). Skipping.`));
      continue;
    }
    const liveMarket = picked.market;
    const liveEntry = picked.entries[0];
    info("marketId", liveMarket.id);
    info("title", liveMarket.title);
    info("entry", `${liveEntry.label} (${liveEntry.id.slice(0, 8)})`);

    // Capture Alice's prior position before buying so we can assert the
    // delta after the buy. The smoke runs against real live markets in
    // production, so Alice may already hold shares from previous smoke
    // runs — a strict equality check on netShares would spuriously
    // fail on the second+ run.
    let priorNetShares = 0;
    try {
      const prePos = await api<any>(
        alice,
        "GET",
        `/api/markets/${liveMarket.id}/amm-position`,
      );
      const priorRow = prePos.positions?.find((p: any) => p.entryId === liveEntry.id);
      priorNetShares = Number(priorRow?.netShares ?? 0);
    } catch {
      // No position yet — treat as zero. The post-buy assertion will
      // still be correct because `delta` will equal sharesPurchased.
    }

    step(12, `${mt.label} — Alice buys 100 credits on "${liveEntry.label}"`);
    let liveBuy: any;
    try {
      liveBuy = await api<any>(alice, "POST", mt.betPath(liveMarket.id), {
        entryId: liveEntry.id,
        stakeAmount: 100,
        actionType: "buy",
      });
    } catch (err: any) {
      console.log(red(`    ✗ Buy failed: ${err?.message ?? err}`));
      phaseBFailures++;
      continue;
    }
    info("chargeCredits", liveBuy.chargeCredits);
    info("shares", liveBuy.sharesPurchased.toFixed(4));
    info("avgPrice", liveBuy.pricePerShareAvg.toFixed(4));
    info("remainingCredits", liveBuy.remainingCredits);
    info("xpAwarded", liveBuy.xp ? "yes" : "no");

    if (!liveBuy.xp) {
      console.log(yellow("    ! XP payload missing — placement-hook regression?"));
      phaseBFailures++;
    } else {
      console.log(green("    ✓ Placement hooks fired (xp payload present)"));
    }

    step(13, `${mt.label} — Alice's position`);
    let livePosition: any;
    try {
      livePosition = await api<any>(
        alice,
        "GET",
        `/api/markets/${liveMarket.id}/amm-position`,
      );
    } catch (err: any) {
      console.log(red(`    ✗ Position lookup failed: ${err?.message ?? err}`));
      phaseBFailures++;
      continue;
    }
    const pos = livePosition.positions.find((p: any) => p.entryId === liveEntry.id);
    if (!pos) {
      console.log(red(`    ✗ No position row for entry ${liveEntry.id}.`));
      phaseBFailures++;
      continue;
    }
    info("priorNetShares", priorNetShares.toFixed(4));
    info("netShares", pos.netShares.toFixed(4));
    info("avgEntry", pos.avgEntryPrice.toFixed(4));
    info("currentValue", pos.currentValue.toFixed(2));

    const delta = Number(pos.netShares) - priorNetShares;
    if (Math.abs(delta - liveBuy.sharesPurchased) > 0.01) {
      console.log(
        red(
          `    ✗ Position drift: buy returned ${liveBuy.sharesPurchased.toFixed(4)} shares but position delta is ${delta.toFixed(4)} (prior=${priorNetShares.toFixed(4)}, now=${pos.netShares.toFixed(4)}).`,
        ),
      );
      phaseBFailures++;
    } else {
      console.log(
        green(
          `    ✓ Position delta (+${delta.toFixed(4)}) matches buy result.`,
        ),
      );
    }

    const sellQty = Math.floor((liveBuy.sharesPurchased / 4) * 100) / 100;
    if (sellQty <= 0) {
      console.log(yellow(`    ! sellQty rounded to 0 — skipping ${mt.label} sell.`));
      continue;
    }

    step(14, `${mt.label} — Alice sells ${sellQty} shares (partial exit)`);
    let liveSell: any;
    try {
      liveSell = await api<any>(alice, "POST", mt.betPath(liveMarket.id), {
        entryId: liveEntry.id,
        actionType: "sell",
        shares: sellQty,
      });
    } catch (err: any) {
      console.log(red(`    ✗ Sell failed: ${err?.message ?? err}`));
      phaseBFailures++;
      continue;
    }
    info("proceeds", liveSell.proceeds);
    info("avgPrice", liveSell.pricePerShareAvg.toFixed(4));
    info("remainingCredits", liveSell.remainingCredits);

    if (liveSell.proceeds > liveBuy.chargeCredits) {
      console.log(
        red(
          `    ✗ Sell proceeds (${liveSell.proceeds}) exceed buy cost (${liveBuy.chargeCredits}). LMSR spread should make this impossible.`,
        ),
      );
      phaseBFailures++;
    } else {
      console.log(
        green(
          `    ✓ ${mt.label} round-trip cost: ${liveBuy.chargeCredits - liveSell.proceeds} credits over ${(liveBuy.sharesPurchased - sellQty).toFixed(4)} held shares.`,
        ),
      );
    }
  }

  if (phaseBFailures > 0) {
    console.log(red(bold(`\n✗ Phase B failed with ${phaseBFailures} issue(s).`)));
    process.exitCode = 1;
  } else {
    console.log(green(bold("\n✓ Phase B passed across H2H / UpDown / Race.")));
  }

  // ===================================================================
  // Phase C — jackpot end-to-end smoke
  // ===================================================================
  // 1. List OPEN jackpot markets, pick the first one.
  // 2. Alice places a jackpot bet (predictedScore = 42).
  // 3. Force-resolve via the env-gated admin endpoint with the same
  //    actualScore so alice's bet wins.
  // 4. Assert the market is RESOLVED and the resolutionNotes carry the
  //    correct outcome.
  //
  // Requires `SMOKE_FORCE_RESOLVE=true` on the target deployment.
  // Skip with a warning if the flag is off or no OPEN jackpot exists.
  // ===================================================================

  console.log(`\n${cyan(bold("=== Phase C — jackpot end-to-end smoke ==="))}`);

  if (String(process.env.SMOKE_PHASE_C ?? "").toLowerCase() === "skip") {
    console.log(yellow("    ! SMOKE_PHASE_C=skip — skipping jackpot smoke."));
    return;
  }

  step(15, "Pick an OPEN jackpot market");
  let jackpotList: any[];
  try {
    jackpotList = await api<any[]>(alice, "GET", "/api/native-markets/jackpot");
  } catch (err: any) {
    console.log(red(`    ✗ Jackpot list lookup failed: ${err?.message ?? err}`));
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(jackpotList) || jackpotList.length === 0) {
    console.log(yellow("    ! No OPEN jackpot market found — skipping Phase C."));
    return;
  }
  const jackpot = jackpotList[0];
  info("marketId", jackpot.id);
  info("title", jackpot.title ?? jackpot.slug ?? "(untitled)");

  const predictedScore = 42;
  step(16, `Alice places a jackpot ticket (predictedScore=${predictedScore})`);
  let jackpotBet: any;
  try {
    jackpotBet = await api<any>(
      alice,
      "POST",
      `/api/native-markets/${jackpot.id}/jackpot-bet`,
      { predictedScore },
    );
  } catch (err: any) {
    if (String(err?.message ?? "").includes("already")) {
      console.log(yellow(`    ! Alice already has a bet on this jackpot — Phase C cannot proceed cleanly. Skipping.`));
      return;
    }
    console.log(red(`    ✗ Jackpot bet failed: ${err?.message ?? err}`));
    process.exitCode = 1;
    return;
  }
  info("betId", jackpotBet.betId);
  info("stakeAmount", jackpotBet.stakeAmount);
  info("xpAwarded", jackpotBet.xp ? "yes" : "no");

  step(17, "Force-resolve the jackpot with actualScore=" + predictedScore);
  let resolveResult: any;
  try {
    resolveResult = await api<any>(
      alice,
      "POST",
      `/api/admin/native-markets/${jackpot.id}/force-resolve-jackpot`,
      { actualScore: predictedScore },
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("SMOKE_FORCE_RESOLVE") || msg.includes("disabled")) {
      console.log(yellow(`    ! Force-resolve endpoint is disabled on this deployment. Set SMOKE_FORCE_RESOLVE=true to enable Phase C.`));
      return;
    }
    console.log(red(`    ✗ Force-resolve failed: ${msg}`));
    process.exitCode = 1;
    return;
  }
  info("outcome", resolveResult.outcome);
  info("status", resolveResult.market?.status);
  info("resolvedAt", resolveResult.market?.resolvedAt);

  if (resolveResult.outcome !== "resolved" || resolveResult.market?.status !== "RESOLVED") {
    console.log(
      red(
        `    ✗ Jackpot did not transition to RESOLVED. outcome=${resolveResult.outcome}, status=${resolveResult.market?.status}.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  let notes: any = null;
  try {
    notes = resolveResult.market?.resolutionNotes
      ? JSON.parse(resolveResult.market.resolutionNotes)
      : null;
  } catch {
    /* keep null */
  }
  if (notes) {
    info("actualScore", notes.actualScore);
    info("winningPrediction", notes.winningPrediction);
    info("totalEntries", notes.totalEntries);
    info("tiedWinners", notes.tiedWinners);

    if (notes.actualScore === predictedScore && notes.winningPrediction === predictedScore) {
      console.log(green(bold("\n✓ Phase C jackpot smoke passed — alice's prediction matched the override score and won.")));
    } else {
      console.log(
        yellow(
          `    ! Jackpot resolved but alice didn't win solo (winningPrediction=${notes.winningPrediction}). Other entrants may have been closer.`,
        ),
      );
    }
  } else {
    console.log(yellow("    ! resolutionNotes missing or unparseable; manual verification recommended."));
  }
}

main().catch((err) => {
  console.error(red(`\n[amm-smoke] FAILED: ${err?.message ?? err}`));
  if (err?.stack) console.error(dim(err.stack));
  process.exit(1);
});
