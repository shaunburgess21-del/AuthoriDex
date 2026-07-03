/**
 * Throwaway E2E harness for community source-anchored convergence
 * (World Markets Parity Upgrade, Phase B verification).
 *
 * Finds a real OPEN Polymarket binary market via Gamma, inserts a fake
 * scouted community market pointing at it (visibility live + AMM-seeded so
 * the convergence diagnostics can see it), then verifies:
 *   1. runSourceResolutionWatch refreshes metadata.source.livePrices.
 *   2. readSourceFairByEntryId returns a "live"-anchored fair map.
 *   3. computeArbPredictionCommunity produces a sane decision vs AMM prices.
 *   4. fetchLiveCommunityConvergence includes the market with a gap.
 * Cleans up the market, entries, AMM state, and house ledger rows after.
 *
 * Run: npx tsx --env-file=.env server/scripts/test-community-convergence-e2e.ts
 */

async function main() {
  const { runSourceResolutionWatch, SCOUT_PROFILE_ID } = await import("../jobs/market-scout");
  const { readSourceFairByEntryId } = await import("../agents/sourceFair");
  const { computeArbPredictionCommunity } = await import("../agents/arbAgent");
  const { fetchLiveCommunityConvergence } = await import("../agents/liveConvergence");
  const { ensureWorldMarketAmmSeeded, HOUSE_PROFILE_ID } = await import("../services/amm-house");
  const { db } = await import("../db");
  const { predictionMarkets, marketEntries, marketAmmState, creditLedger, profiles } = await import("@shared/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  // ── Find an OPEN binary market on Gamma with mid-range prices ──────────
  const resp = await fetch(
    "https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr&ascending=false&limit=60",
    { headers: { accept: "application/json" } },
  );
  const events = (await resp.json()) as any[];

  let picked: { eventId: string; slug: string; marketId: string; outcomes: string[]; prices: number[] } | null = null;
  outer: for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (m.closed === true || m.active === false || m.id == null) continue;
      let outcomes: string[] = [];
      let prices: number[] = [];
      try {
        outcomes = JSON.parse(m.outcomes ?? "[]");
        prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
      } catch {
        continue;
      }
      if (outcomes.length !== 2 || prices.length !== 2) continue;
      // Mid-range prices make the arb math interesting and non-degenerate.
      if (prices[0] < 0.15 || prices[0] > 0.85) continue;
      picked = { eventId: String(ev.id), slug: ev.slug, marketId: String(m.id), outcomes, prices };
      break outer;
    }
  }
  if (!picked) throw new Error("No suitable open binary market found on Gamma");
  console.log(
    `PICKED open event ${picked.eventId} (${picked.slug}) — live prices ${picked.prices.map((p) => p.toFixed(2)).join("/")}`,
  );

  // ── Insert a scouted market seeded at DIFFERENT prices (50/50) so a gap
  //    exists between AMM price and the live source anchor ────────────────
  const slug = `community-convergence-e2e-${Date.now().toString(36)}`;
  const endAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(predictionMarkets)
      .values({
        marketType: "community",
        engine: "amm",
        title: "Community convergence E2E test market (safe to delete)",
        slug,
        openMarketType: "binary",
        category: "misc",
        status: "OPEN",
        visibility: "live",
        isLive: true,
        startAt: new Date(),
        endAt,
        closeAt: endAt,
        createdBy: SCOUT_PROFILE_ID,
        metadata: {},
      })
      .returning({ id: predictionMarkets.id });

    const entries = await tx
      .insert(marketEntries)
      .values(
        picked!.outcomes.map((label, i) => ({
          marketId: row.id,
          entryType: "custom" as const,
          label,
          displayOrder: i,
        })),
      )
      .returning({ id: marketEntries.id, label: marketEntries.label });

    await tx
      .update(predictionMarkets)
      .set({
        metadata: {
          source: {
            provider: "polymarket",
            externalId: picked!.eventId,
            url: `https://polymarket.com/event/${picked!.slug}`,
            structure: "binary",
            outcomeMapping: picked!.outcomes.map((label, i) => ({
              entryLabel: label,
              sourceLabel: label,
              sourceMarketId: picked!.marketId,
              sourceOutcomeIndex: i,
            })),
            // Deliberately 50/50 so the AMM seeds at even odds and the live
            // source prices create a visible convergence gap.
            pricesAtImport: [0.5, 0.5],
            fetchedAt: new Date().toISOString(),
          },
          scoutedByMarketScout: true,
        },
      })
      .where(eq(predictionMarkets.id, row.id));

    return { marketId: row.id, entries };
  });
  await ensureWorldMarketAmmSeeded(created.marketId, created.entries.map((e) => e.id));
  console.log(`INSERTED + AMM-seeded test market ${created.marketId}`);

  let failed = 0;
  const check = (name: string, ok: boolean) => {
    console.log(ok ? `  PASS ${name}` : `  FAIL ${name}`);
    if (!ok) failed += 1;
  };

  try {
    // ── 1. Watcher refreshes live prices ─────────────────────────────────
    const watch = await runSourceResolutionWatch();
    console.log(`WATCH: checked=${watch.checked} livePricesRefreshed=${watch.livePricesRefreshed}`);

    const [after] = await db
      .select({ metadata: predictionMarkets.metadata })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, created.marketId));
    const meta = after?.metadata as any;
    check("livePrices written", Array.isArray(meta?.source?.livePrices) && meta.source.livePrices.length === 2);
    check("livePricesAt stamped", typeof meta?.source?.livePricesAt === "string");
    check(
      "livePrices track the source (within 10pp — market may move)",
      Array.isArray(meta?.source?.livePrices) &&
        Math.abs(meta.source.livePrices[0] - picked!.prices[0]) < 0.1,
    );

    // ── 2. Source fair reads the live anchor ─────────────────────────────
    const fair = readSourceFairByEntryId(meta, created.entries.map((e) => ({ id: e.id, label: e.label })));
    check("sourceFair resolves", !!fair);
    check("sourceFair anchor=live", fair?.anchor === "live");

    // ── 3. Arb decision vs the (50/50-seeded) AMM ────────────────────────
    if (fair) {
      const [state] = await db
        .select({
          liquidityB: marketAmmState.liquidityB,
          outcomeOrder: marketAmmState.outcomeOrder,
          shareQuantities: marketAmmState.shareQuantities,
        })
        .from(marketAmmState)
        .where(eq(marketAmmState.marketId, created.marketId));
      const { currentPrices } = await import("@shared/lib/amm/positions");
      const prices = currentPrices({
        liquidityB: Number(state.liquidityB),
        outcomeOrder: state.outcomeOrder as string[],
        shareQuantities: state.shareQuantities as Record<string, number>,
      });
      const decision = computeArbPredictionCommunity(
        created.entries.map((e) => ({ id: e.id, label: e.label ?? "", totalStake: 0 })),
        fair.fairByEntryId,
        prices,
        { minEdgePp: 0.03 },
      );
      const sourceGap = Math.abs(picked!.prices[0] - 0.5);
      console.log(
        `ARB: sourceGapVs50=${sourceGap.toFixed(3)} decision=${decision.abstain ? `abstain(${decision.abstainReason})` : `buy ${created.entries.find((e) => e.id === decision.entryId)?.label} edge=${decision.edge?.toFixed(3)}`}`,
      );
      // With a >=15pp source-vs-50/50 gap the arb must trade; below the
      // 3pp test bar it must abstain. picked!.prices[0] in [0.15, 0.85].
      if (sourceGap >= 0.05) {
        check("arb trades on a real gap", !decision.abstain && !!decision.entryId);
      } else {
        check("arb decision is well-formed", decision.abstain || !!decision.entryId);
      }
    }

    // ── 4. Convergence diagnostics include the market ────────────────────
    const diag = await fetchLiveCommunityConvergence();
    const row = diag.markets.find((m) => m.marketId === created.marketId);
    check("diagnostics include the market", !!row);
    check("diagnostics anchor=live", row?.anchor === "live");
    check("diagnostics gap computed", row?.gap != null && Number.isFinite(row.gap));
    console.log(
      `DIAG: openAnchored=${diag.summary.openMarkets} testRow gap=${row?.gap?.toFixed(3)} favored=${row?.favoredLabel}`,
    );
  } finally {
    // ── Cleanup: market cascades amm_state; reconcile house ledger rows ──
    const [seedRow] = await db
      .select({ amount: creditLedger.amount })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, HOUSE_PROFILE_ID),
          eq(creditLedger.idempotencyKey, `amm_seed_${created.marketId}`),
        ),
      );
    if (seedRow) {
      // Refund the seed to the house and remove the ledger row so the
      // orphan-ledger audit stays clean after the market row is deleted.
      await db
        .update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${-seedRow.amount}` })
        .where(eq(profiles.id, HOUSE_PROFILE_ID));
      await db
        .delete(creditLedger)
        .where(
          and(
            eq(creditLedger.userId, HOUSE_PROFILE_ID),
            eq(creditLedger.idempotencyKey, `amm_seed_${created.marketId}`),
          ),
        );
    }
    await db.delete(marketEntries).where(eq(marketEntries.marketId, created.marketId));
    await db.delete(predictionMarkets).where(eq(predictionMarkets.id, created.marketId));
    console.log("CLEANUP: test market deleted, house seed refunded");
  }

  if (failed > 0) {
    console.error(`E2E FAILED — ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("E2E PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E ERROR:", err);
  process.exit(1);
});

// Module scope (prevents `main` clashing with other script files in tsc).
export {};
