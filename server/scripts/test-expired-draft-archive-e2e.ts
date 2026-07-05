/**
 * Throwaway E2E for the expired-draft auto-archive path in the market
 * resolver (server/jobs/market-resolver.ts, community branch).
 *
 * Inserts two expired community drafts and runs the real resolver:
 *   A) zero financial state (no AMM seed, no bets)  -> expect VOID + archived
 *   B) has a market_amm_state row (as if seeded)     -> expect CLOSED_PENDING
 *
 * Safe to run only when there is no other expired OPEN market backlog (the
 * resolver processes ALL expired markets); the script aborts if it finds any.
 * Cleans up everything it creates.
 *
 * Run: npx tsx --env-file=.env server/scripts/test-expired-draft-archive-e2e.ts
 */

async function main() {
  const { db } = await import("../db");
  const { predictionMarkets, marketEntries, marketAmmState } = await import("@shared/schema");
  const { eq, and, lte } = await import("drizzle-orm");
  const { resolveExpiredMarkets } = await import("../jobs/market-resolver");
  const { SCOUT_PROFILE_ID } = await import("../jobs/market-scout");

  const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const suffix = Math.random().toString(36).slice(2, 8);

  async function insertDraft(tag: string, extId: string) {
    const [row] = await db
      .insert(predictionMarkets)
      .values({
        marketType: "community",
        engine: "amm",
        title: `Expired draft archive E2E ${tag} (safe to delete)`,
        slug: `expired-draft-e2e-${tag}-${suffix}`,
        openMarketType: "binary",
        category: "misc",
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endAt: past,
        closeAt: past,
        resolveMethod: "admin_manual",
        status: "OPEN",
        visibility: "draft",
        isLive: false,
        createdBy: SCOUT_PROFILE_ID,
        metadata: {
          source: { provider: "polymarket", externalId: extId },
          scoutedByMarketScout: true,
        },
      })
      .returning({ id: predictionMarkets.id });
    const entries = await db
      .insert(marketEntries)
      .values([
        { marketId: row.id, entryType: "custom" as const, label: "Yes", displayOrder: 0 },
        { marketId: row.id, entryType: "custom" as const, label: "No", displayOrder: 1 },
      ])
      .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });
    return { id: row.id, entries };
  }

  const created: string[] = [];
  try {
    // Guard: only run when no other expired OPEN markets exist, so the real
    // resolver can't settle unrelated markets as a side effect.
    const preexisting = await db
      .select({ id: predictionMarkets.id })
      .from(predictionMarkets)
      .where(and(eq(predictionMarkets.status, "OPEN"), lte(predictionMarkets.endAt, new Date())));
    if (preexisting.length > 0) {
      throw new Error(
        `Aborting: ${preexisting.length} other expired OPEN market(s) exist; running the resolver could settle them.`,
      );
    }

    // A) zero-state draft
    const a = await insertDraft("zero", `e2e-zero-${suffix}`);
    created.push(a.id);

    // B) draft WITH an AMM state row (control: must still go CLOSED_PENDING)
    const b = await insertDraft("seeded", `e2e-seeded-${suffix}`);
    created.push(b.id);
    const order = b.entries.slice().sort((x, y) => x.displayOrder - y.displayOrder).map((e) => e.id);
    await db.insert(marketAmmState).values({
      marketId: b.id,
      liquidityB: "100",
      outcomeOrder: order,
      shareQuantities: Object.fromEntries(order.map((id) => [id, 0])),
      houseSeedAmount: 100,
    });

    console.log(`INSERTED zero-state=${a.id.slice(0, 8)} seeded=${b.id.slice(0, 8)}`);

    // Run the real resolver.
    await resolveExpiredMarkets();

    const [aRow] = await db
      .select({
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        resolveMethod: predictionMarkets.resolveMethod,
        voidReason: predictionMarkets.voidReason,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, a.id));
    const [bRow] = await db
      .select({ status: predictionMarkets.status, visibility: predictionMarkets.visibility })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, b.id));

    console.log("ZERO-STATE ROW:", aRow);
    console.log("SEEDED ROW:", bRow);

    const assertions: Array<[string, boolean]> = [
      ["zero-state draft -> status VOID", aRow.status === "VOID"],
      ["zero-state draft -> visibility archived", aRow.visibility === "archived"],
      ["zero-state draft -> resolveMethod auto", aRow.resolveMethod === "auto"],
      ["zero-state draft -> voidReason set", aRow.voidReason === "Draft expired unpublished"],
      ["seeded draft -> status CLOSED_PENDING (not archived)", bRow.status === "CLOSED_PENDING"],
      ["seeded draft -> visibility unchanged (draft)", bRow.visibility === "draft"],
    ];
    let failed = 0;
    for (const [name, ok] of assertions) {
      console.log(ok ? `  PASS ${name}` : `  FAIL ${name}`);
      if (!ok) failed += 1;
    }

    if (failed > 0) {
      console.error(`E2E FAILED — ${failed} assertion(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("E2E PASSED");
    }
  } finally {
    for (const id of created) {
      await db.delete(marketAmmState).where(eq(marketAmmState.marketId, id));
      await db.delete(marketEntries).where(eq(marketEntries.marketId, id));
      await db.delete(predictionMarkets).where(eq(predictionMarkets.id, id));
    }
    console.log(`CLEANUP: deleted ${created.length} test market(s)`);
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("E2E ERROR:", err);
  process.exit(1);
});
