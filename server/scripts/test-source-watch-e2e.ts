/**
 * Throwaway E2E harness for the Market Scout source-resolution watcher
 * (Phase 3 verification).
 *
 * Finds a real RESOLVED Polymarket event via Gamma, inserts a fake scouted
 * community market pointing at it (status OPEN, outcomeMapping in metadata),
 * runs the real `runSourceResolutionWatch()`, and verifies the watcher wrote
 * a `metadata.scoutAssessment` proposing the correct winner. Cleans up after.
 *
 * Run: npx tsx --env-file=.env server/scripts/test-source-watch-e2e.ts
 */

async function main() {
  const { runSourceResolutionWatch, SCOUT_PROFILE_ID } = await import("../jobs/market-scout");
  const { db } = await import("../db");
  const { predictionMarkets, marketEntries } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  // ── Find a resolved (closed) binary event on Gamma ─────────────────────
  const resp = await fetch(
    "https://gamma-api.polymarket.com/events?closed=true&order=volume24hr&ascending=false&limit=40",
    { headers: { accept: "application/json" } },
  );
  const events = (await resp.json()) as any[];

  // Any closed binary market inside a closed event works — the watcher
  // maps entries via sourceMarketId, exactly like a scouted binary import.
  let picked: { eventId: string; slug: string; marketId: string; outcomes: string[]; winnerIdx: number } | null = null;
  outer: for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (m.closed !== true || m.id == null) continue;
      let outcomes: string[] = [];
      let prices: number[] = [];
      try {
        outcomes = JSON.parse(m.outcomes ?? "[]");
        prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
      } catch {
        continue;
      }
      if (outcomes.length !== 2 || prices.length !== 2) continue;
      const winnerIdx = prices.findIndex((p) => p >= 0.99);
      if (winnerIdx < 0) continue;
      picked = { eventId: String(ev.id), slug: ev.slug, marketId: String(m.id), outcomes, winnerIdx };
      break outer;
    }
  }
  if (!picked) throw new Error("Could not find a cleanly-resolved binary event on Gamma");
  console.log(
    `PICKED resolved event ${picked.eventId} (${picked.slug}) — winner: "${picked.outcomes[picked.winnerIdx]}"`,
  );

  // ── Insert a fake scouted market pointing at it ────────────────────────
  const slug = `scout-watch-e2e-test-${Date.now().toString(36)}`;
  const endAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(predictionMarkets)
      .values({
        marketType: "community",
        engine: "amm",
        title: "Scout watch E2E test market (safe to delete)",
        slug,
        openMarketType: "binary",
        category: "misc",
        status: "OPEN",
        visibility: "draft",
        isLive: false,
        startAt: new Date(),
        endAt,
        closeAt: endAt,
        createdBy: SCOUT_PROFILE_ID,
        metadata: {}, // outcomeMapping filled below once entry ids exist
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
      .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });

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
            pricesAtImport: [0.5, 0.5],
            fetchedAt: new Date().toISOString(),
          },
          scoutedByMarketScout: true,
        },
      })
      .where(eq(predictionMarkets.id, row.id));

    return { marketId: row.id, entries };
  });
  console.log(`INSERTED test market ${created.marketId} with ${created.entries.length} entries`);

  let failed = 0;
  try {
    // ── Run the watcher ──────────────────────────────────────────────────
    const watch = await runSourceResolutionWatch();
    console.log("WATCH RESULT:", JSON.stringify(watch, null, 2));

    const finding = watch.findings.find((f) => f.marketId === created.marketId);
    const expectedWinnerLabel = picked.outcomes[picked.winnerIdx];

    const [after] = await db
      .select({ metadata: predictionMarkets.metadata })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, created.marketId));
    const meta = after?.metadata as any;
    const assessment = meta?.scoutAssessment;
    console.log("ASSESSMENT:", JSON.stringify(assessment, null, 2));

    const expectedEntry = created.entries[picked.winnerIdx];
    const checks: Array<[string, boolean]> = [
      ["finding emitted for test market", !!finding],
      ["finding proposes source winner", finding?.proposedWinnerLabel === expectedWinnerLabel],
      ["assessment written", !!assessment],
      ["stage=met", assessment?.stage === "met"],
      ["action=resolve_now", assessment?.recommendedAction === "resolve_now"],
      ["proposedWinnerEntryId maps to correct entry", assessment?.proposedWinnerEntryId === expectedEntry.id],
      ["upstreamResolvedAt stamped", typeof meta?.source?.upstreamResolvedAt === "string"],
      ["source metadata preserved", meta?.source?.externalId === picked.eventId],
      ["scoutWatch metadata preserved", meta?.scoutedByMarketScout === true],
    ];
    for (const [name, ok] of checks) {
      console.log(ok ? `  PASS ${name}` : `  FAIL ${name}`);
      if (!ok) failed += 1;
    }

    // ── Rerun: must skip (upstreamResolvedAt short-circuits) ─────────────
    const rerun = await runSourceResolutionWatch();
    const reruncheckedThis = rerun.findings.some((f) => f.marketId === created.marketId);
    console.log(
      !reruncheckedThis
        ? "  PASS rerun skipped the already-recorded market"
        : "  FAIL rerun re-processed the market",
    );
    if (reruncheckedThis) failed += 1;
  } finally {
    await db.delete(marketEntries).where(eq(marketEntries.marketId, created.marketId));
    await db.delete(predictionMarkets).where(eq(predictionMarkets.id, created.marketId));
    console.log("CLEANUP: test market deleted");
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
