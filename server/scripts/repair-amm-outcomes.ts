/**
 * Repair tool for community-market AMM state rows whose `outcome_order`
 * (and matching `share_quantities` keyset) drifted out of sync with the
 * actual `market_entries` for the market.
 *
 * Background:
 * The re-add of the world markets after the parimutuel sunset left
 * several multi-outcome markets in a state where the AMM was seeded
 * with fewer outcomes than the entries that exist. Outcomes missing
 * from `outcome_order` render at 0 % / 0.000 cr on the UI and are
 * un-buyable (executeBuy rejects them).
 *
 * The script offers two repair paths per market:
 *
 *   1. Wipe-and-reseed (safe path): used when `total_user_credits_in
 *      = 0` AND `(SELECT COUNT(*) FROM market_bets WHERE market_id =
 *      m.id) = 0`. Deletes `market_amm_state`, deletes the
 *      `amm_seed_${marketId}` credit-ledger row, refunds the original
 *      `house_seed_amount` to the house, then calls `seedAmmMarket`
 *      with the full ordered entry list so `b` is recomputed against
 *      the correct `N`.
 *
 *   2. Safe-extend (preserve-trades path): used when the market has
 *      bets or non-zero credits-in. Appends the missing entry IDs to
 *      `outcome_order` and adds `q = 0` for each in `share_quantities`.
 *      Does NOT recompute `b` (changing `b` after trades would shift
 *      every position's value). Logs a warning that `b` was originally
 *      sized for fewer outcomes than the market actually has.
 *
 * Both paths run inside a single transaction per market.
 *
 * Flags:
 *   --apply             actually perform the repair (default = dry run)
 *   --market <slug>     only inspect/repair the given market slug
 *
 * Examples:
 *   npm run repair:amm-outcomes
 *   npm run repair:amm-outcomes -- --apply
 *   npm run repair:amm-outcomes -- --market f1-champion-2026
 *   npm run repair:amm-outcomes -- --market f1-champion-2026 --apply
 *
 * Idempotent: re-running on a clean DB is a no-op (the audit reports
 * zero broken markets and exits 0). The script re-audits at the end
 * and exits non-zero if anything is still inconsistent.
 */

import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  creditLedger,
  marketAmmState,
  marketBets,
  marketEntries,
  predictionMarkets,
  profiles,
} from "@shared/schema";
import {
  HOUSE_PROFILE_ID,
  seedAmmMarket,
} from "../services/amm-house";

interface CliArgs {
  apply: boolean;
  market?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") {
      args.apply = true;
    } else if (a === "--market") {
      args.market = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

interface MarketRow {
  id: string;
  slug: string;
  title: string | null;
  openMarketType: string | null;
  status: string;
  visibility: string | null;
  entriesCount: number;
  entryIdsInOrder: string[];
  ammPresent: boolean;
  ammOutcomeOrder: string[];
  ammShareQuantities: Record<string, number>;
  ammHouseSeedAmount: number | null;
  ammTotalUserCreditsIn: number;
  ammLiquidityB: number;
  betsCount: number;
}

async function loadCommunityMarkets(slugFilter?: string): Promise<MarketRow[]> {
  const whereClause = slugFilter
    ? and(eq(predictionMarkets.marketType, "community"), eq(predictionMarkets.slug, slugFilter))
    : eq(predictionMarkets.marketType, "community");

  const markets = await db
    .select({
      id: predictionMarkets.id,
      slug: predictionMarkets.slug,
      title: predictionMarkets.title,
      openMarketType: predictionMarkets.openMarketType,
      status: predictionMarkets.status,
      visibility: predictionMarkets.visibility,
    })
    .from(predictionMarkets)
    .where(whereClause)
    .orderBy(asc(predictionMarkets.createdAt));

  const rows: MarketRow[] = [];
  for (const m of markets) {
    const entries = await db
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, m.id))
      .orderBy(asc(marketEntries.displayOrder));

    const [ammRow] = await db
      .select({
        outcomeOrder: marketAmmState.outcomeOrder,
        shareQuantities: marketAmmState.shareQuantities,
        houseSeedAmount: marketAmmState.houseSeedAmount,
        totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
        liquidityB: marketAmmState.liquidityB,
      })
      .from(marketAmmState)
      .where(eq(marketAmmState.marketId, m.id))
      .limit(1);

    const [betsRow] = await db
      .select({ n: count() })
      .from(marketBets)
      .where(eq(marketBets.marketId, m.id));

    rows.push({
      id: m.id,
      slug: m.slug,
      title: m.title,
      openMarketType: m.openMarketType,
      status: m.status,
      visibility: m.visibility,
      entriesCount: entries.length,
      entryIdsInOrder: entries.map((e) => e.id),
      ammPresent: !!ammRow,
      ammOutcomeOrder: (ammRow?.outcomeOrder as string[] | null) ?? [],
      ammShareQuantities:
        (ammRow?.shareQuantities as Record<string, number> | null) ?? {},
      ammHouseSeedAmount: ammRow?.houseSeedAmount ?? null,
      ammTotalUserCreditsIn: Number(ammRow?.totalUserCreditsIn ?? 0),
      ammLiquidityB: Number(ammRow?.liquidityB ?? 0),
      betsCount: Number(betsRow?.n ?? 0),
    });
  }
  return rows;
}

type DriftKind = "ok" | "no_amm_row" | "outcome_missing" | "shares_missing";

interface MarketDrift {
  kind: DriftKind;
  missingFromOutcomeOrder: string[];
  missingFromShareQuantities: string[];
  extrasInOutcomeOrder: string[];
}

function classifyDrift(row: MarketRow): MarketDrift {
  if (!row.ammPresent) {
    return {
      kind: "no_amm_row",
      missingFromOutcomeOrder: row.entryIdsInOrder.slice(),
      missingFromShareQuantities: row.entryIdsInOrder.slice(),
      extrasInOutcomeOrder: [],
    };
  }
  const entrySet = new Set(row.entryIdsInOrder);
  const ammSet = new Set(row.ammOutcomeOrder);
  const missingFromOutcomeOrder = row.entryIdsInOrder.filter((id) => !ammSet.has(id));
  const extrasInOutcomeOrder = row.ammOutcomeOrder.filter((id) => !entrySet.has(id));
  const missingFromShareQuantities = row.entryIdsInOrder.filter(
    (id) => !(id in row.ammShareQuantities),
  );
  if (
    missingFromOutcomeOrder.length === 0 &&
    extrasInOutcomeOrder.length === 0 &&
    missingFromShareQuantities.length === 0
  ) {
    return {
      kind: "ok",
      missingFromOutcomeOrder: [],
      missingFromShareQuantities: [],
      extrasInOutcomeOrder: [],
    };
  }
  return {
    kind: missingFromOutcomeOrder.length > 0 ? "outcome_missing" : "shares_missing",
    missingFromOutcomeOrder,
    missingFromShareQuantities,
    extrasInOutcomeOrder,
  };
}

function printAuditTable(rows: { row: MarketRow; drift: MarketDrift }[]): void {
  console.log("");
  console.log(
    "slug".padEnd(36) +
      "type".padEnd(8) +
      "entries".padStart(8) +
      "amm".padStart(6) +
      "bets".padStart(6) +
      "creditsIn".padStart(11) +
      "  status",
  );
  console.log("-".repeat(96));
  for (const { row, drift } of rows) {
    const statusLabel =
      drift.kind === "ok"
        ? "ok"
        : drift.kind === "no_amm_row"
          ? "NO AMM ROW"
          : `BROKEN (missing ${drift.missingFromOutcomeOrder.length})`;
    console.log(
      row.slug.slice(0, 35).padEnd(36) +
        (row.openMarketType ?? "?").padEnd(8) +
        String(row.entriesCount).padStart(8) +
        String(row.ammOutcomeOrder.length).padStart(6) +
        String(row.betsCount).padStart(6) +
        row.ammTotalUserCreditsIn.toFixed(0).padStart(11) +
        "  " +
        statusLabel,
    );
  }
}

async function repairWipeAndReseed(row: MarketRow): Promise<void> {
  console.log(`  [wipe-reseed] ${row.slug}: refunding ${row.ammHouseSeedAmount ?? 0} cr to house, reseeding ${row.entriesCount} outcomes`);

  await db.transaction(async (tx) => {
    const idempotencyKey = `amm_seed_${row.id}`;

    if (row.ammHouseSeedAmount && row.ammHouseSeedAmount > 0) {
      const [updatedHouse] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} + ${row.ammHouseSeedAmount}`,
        })
        .where(eq(profiles.id, HOUSE_PROFILE_ID))
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedHouse) {
        throw new Error(
          `[repair-amm-outcomes] House profile ${HOUSE_PROFILE_ID} missing — cannot refund seed for ${row.slug}`,
        );
      }

      await tx.insert(creditLedger).values({
        userId: HOUSE_PROFILE_ID,
        txnType: "amm_seed_refund",
        amount: row.ammHouseSeedAmount,
        walletType: "VIRTUAL",
        balanceAfter: updatedHouse.predictCredits,
        source: "amm_repair",
        idempotencyKey: `amm_seed_refund_${row.id}_${Date.now()}`,
        metadata: {
          marketId: row.id,
          reason: "repair-amm-outcomes wipe-and-reseed",
          originalSeedAmount: row.ammHouseSeedAmount,
          originalLiquidityB: row.ammLiquidityB,
          originalOutcomeOrderLength: row.ammOutcomeOrder.length,
          entriesCount: row.entriesCount,
        },
      });
    }

    await tx
      .delete(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, HOUSE_PROFILE_ID),
          eq(creditLedger.idempotencyKey, idempotencyKey),
        ),
      );

    await tx.delete(marketAmmState).where(eq(marketAmmState.marketId, row.id));

    await seedAmmMarket(
      {
        marketId: row.id,
        marketType: "community",
        entryIdsInOrder: row.entryIdsInOrder,
      },
      tx,
    );
  });

  console.log(`  [wipe-reseed] ${row.slug}: done`);
}

async function repairSafeExtend(row: MarketRow, drift: MarketDrift): Promise<void> {
  const newOutcomeOrder = [
    ...row.ammOutcomeOrder,
    ...drift.missingFromOutcomeOrder,
  ];
  const newShareQuantities: Record<string, number> = { ...row.ammShareQuantities };
  for (const id of row.entryIdsInOrder) {
    if (!(id in newShareQuantities)) newShareQuantities[id] = 0;
  }

  console.log(
    `  [safe-extend] ${row.slug}: appending ${drift.missingFromOutcomeOrder.length} entries (preserving b=${row.ammLiquidityB}, bets=${row.betsCount}, creditsIn=${row.ammTotalUserCreditsIn})`,
  );
  console.warn(
    `  [safe-extend] WARNING: market ${row.slug} has b sized for ${row.ammOutcomeOrder.length} outcomes but now has ${newOutcomeOrder.length}. ` +
      `Worst-case house loss bound changes from b·ln(${row.ammOutcomeOrder.length}) to b·ln(${newOutcomeOrder.length}). Review before relying on settled house P&L.`,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(marketAmmState)
      .set({
        outcomeOrder: newOutcomeOrder,
        shareQuantities: newShareQuantities,
      })
      .where(eq(marketAmmState.marketId, row.id));
  });

  console.log(`  [safe-extend] ${row.slug}: done`);
}

async function repair(row: MarketRow, drift: MarketDrift): Promise<void> {
  if (drift.kind === "ok") return;
  if (drift.kind === "no_amm_row") {
    console.log(`  [seed-missing] ${row.slug}: no AMM state row, seeding fresh`);
    await db.transaction(async (tx) => {
      await seedAmmMarket(
        {
          marketId: row.id,
          marketType: "community",
          entryIdsInOrder: row.entryIdsInOrder,
        },
        tx,
      );
    });
    console.log(`  [seed-missing] ${row.slug}: done`);
    return;
  }
  if (drift.extrasInOutcomeOrder.length > 0) {
    throw new Error(
      `[repair-amm-outcomes] ${row.slug} has ${drift.extrasInOutcomeOrder.length} stale outcome(s) in outcome_order that no longer match any market_entries row. Manual inspection required: ${drift.extrasInOutcomeOrder.join(", ")}`,
    );
  }
  const untraded = row.betsCount === 0 && row.ammTotalUserCreditsIn === 0;
  if (untraded) {
    await repairWipeAndReseed(row);
  } else {
    await repairSafeExtend(row, drift);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[repair-amm-outcomes] starting (apply=${args.apply}${args.market ? ", market=" + args.market : ""})`,
  );

  const rows = await loadCommunityMarkets(args.market);
  if (rows.length === 0) {
    if (args.market) {
      console.error(`[repair-amm-outcomes] no community market matched slug '${args.market}'`);
      process.exit(1);
    }
    console.log("[repair-amm-outcomes] no community markets found");
    return;
  }

  const triaged = rows.map((row) => ({ row, drift: classifyDrift(row) }));
  printAuditTable(triaged);

  const broken = triaged.filter((t) => t.drift.kind !== "ok");
  console.log("");
  console.log(`[repair-amm-outcomes] ${broken.length} broken / ${rows.length} total`);

  if (broken.length === 0) {
    console.log("[repair-amm-outcomes] nothing to repair");
    return;
  }

  if (!args.apply) {
    console.log("");
    console.log("Dry run — pass --apply to repair. Repair plan per market:");
    for (const { row, drift } of broken) {
      const path =
        drift.kind === "no_amm_row"
          ? "seed-missing"
          : drift.extrasInOutcomeOrder.length > 0
            ? "MANUAL (stale outcomes)"
            : row.betsCount === 0 && row.ammTotalUserCreditsIn === 0
              ? "wipe-and-reseed"
              : "safe-extend";
      console.log(
        `  ${row.slug.padEnd(36)} ${path.padEnd(24)} missing=[${drift.missingFromOutcomeOrder.join(", ")}]`,
      );
    }
    return;
  }

  console.log("");
  console.log("[repair-amm-outcomes] applying repairs...");
  for (const { row, drift } of broken) {
    try {
      await repair(row, drift);
    } catch (err) {
      console.error(`[repair-amm-outcomes] FAILED to repair ${row.slug}:`, err);
      throw err;
    }
  }

  console.log("");
  console.log("[repair-amm-outcomes] re-auditing...");
  const rowsAfter = await loadCommunityMarkets(args.market);
  const triagedAfter = rowsAfter.map((row) => ({ row, drift: classifyDrift(row) }));
  const stillBroken = triagedAfter.filter((t) => t.drift.kind !== "ok");
  printAuditTable(triagedAfter);
  console.log("");
  console.log(`[repair-amm-outcomes] ${stillBroken.length} still broken after repair`);
  if (stillBroken.length > 0) {
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[repair-amm-outcomes] fatal error", err);
    process.exit(1);
  });
