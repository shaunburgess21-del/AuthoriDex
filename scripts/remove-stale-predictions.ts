import { pool } from "../server/db";

type TargetBet = {
  betId: string;
  username: string;
  marketTitle: string;
};

type TargetBetRow = {
  bet_id: string;
  user_id: string;
  username: string;
  market_id: string;
  market_title: string;
  market_slug: string;
  visibility: string | null;
  market_status: string;
  bet_status: string;
  entry_id: string;
  entry_label: string;
  stake_amount: number;
  payout_amount: number | null;
  created_at: string;
  settled_at: string | null;
};

type LedgerRow = {
  id: string;
  user_id: string;
  amount: number;
  txn_type: string;
  idempotency_key: string;
};

const TARGET_BETS: TargetBet[] = [
  {
    betId: "b1039359-d493-4838-a853-5bb6c01d017e",
    username: "andrewdburgess001927",
    marketTitle: "Will Bitcoin be above or below 100,000 by 31 July 2026",
  },
  {
    betId: "0206cc69-68b4-40d0-9269-0b27cf213751",
    username: "andrewdburgess001927",
    marketTitle: "[TEST]",
  },
  {
    betId: "b65a56b3-2136-4e2d-8670-2a36f952c4ec",
    username: "ShaunAdmin",
    marketTitle: "[TEST]",
  },
];

const EXECUTE = process.argv.includes("--execute");

function roundWinRate(wonCount: number, lostCount: number): number {
  const totalResolved = wonCount + lostCount;
  if (totalResolved <= 0) return 0;
  return Math.round((wonCount / totalResolved) * 1000) / 10;
}

async function loadTargetBets(client: Awaited<ReturnType<typeof pool.connect>>): Promise<TargetBetRow[]> {
  const betIds = TARGET_BETS.map((target) => target.betId);
  const result = await client.query<TargetBetRow>(
    `
      select
        mb.id as bet_id,
        mb.user_id,
        p.username,
        mb.market_id,
        pm.title as market_title,
        pm.slug as market_slug,
        pm.visibility,
        pm.status as market_status,
        mb.status as bet_status,
        mb.entry_id,
        me.label as entry_label,
        mb.stake_amount,
        mb.payout_amount,
        mb.created_at::text,
        mb.settled_at::text
      from market_bets mb
      join profiles p on p.id = mb.user_id
      join prediction_markets pm on pm.id = mb.market_id
      join market_entries me on me.id = mb.entry_id
      where mb.id = any($1::text[])
      order by p.username, mb.created_at
    `,
    [betIds],
  );

  if (result.rows.length !== TARGET_BETS.length) {
    throw new Error(`Expected ${TARGET_BETS.length} target bets, found ${result.rows.length}`);
  }

  for (const target of TARGET_BETS) {
    const row = result.rows.find((candidate) => candidate.bet_id === target.betId);
    if (!row) throw new Error(`Missing target bet ${target.betId}`);
    if (row.username !== target.username || row.market_title !== target.marketTitle) {
      throw new Error(
        `Target bet ${target.betId} no longer matches expected row. Expected ${target.username} / ${target.marketTitle}, got ${row.username} / ${row.market_title}`,
      );
    }
  }

  return result.rows;
}

async function loadLedgerRows(
  client: Awaited<ReturnType<typeof pool.connect>>,
  bets: TargetBetRow[],
): Promise<LedgerRow[]> {
  const betIds = bets.map((bet) => bet.bet_id);
  const likePatterns = betIds.map((betId) => `%${betId}%`);
  const result = await client.query<LedgerRow>(
    `
      select id, user_id, amount, txn_type, idempotency_key
      from credit_ledger
      where
        (metadata->>'betId') = any($1::text[])
        or idempotency_key like any($2::text[])
      order by created_at
    `,
    [betIds, likePatterns],
  );

  return result.rows;
}

async function recomputeProfileStats(
  client: Awaited<ReturnType<typeof pool.connect>>,
  userId: string,
) {
  const [betCountsResult, resolvedBetsResult] = await Promise.all([
    client.query<{ total_predictions: string }>(
      `
        select count(*)::int as total_predictions
        from market_bets
        where user_id = $1
      `,
      [userId],
    ),
    client.query<{ status: string; settled_at: string | null }>(
      `
        select status, settled_at::text
        from market_bets
        where user_id = $1
          and status in ('won', 'lost')
        order by settled_at desc nulls last
      `,
      [userId],
    ),
  ]);

  const totalPredictions = Number(betCountsResult.rows[0]?.total_predictions ?? 0);
  const resolvedBets = resolvedBetsResult.rows;
  const wonCount = resolvedBets.filter((bet) => bet.status === "won").length;
  const lostCount = resolvedBets.filter((bet) => bet.status === "lost").length;
  const winRate = roundWinRate(wonCount, lostCount);

  // Streak overhaul: profiles.current_streak now belongs exclusively
  // to the daily-login streak (see shared/streak-config.ts and the
  // /api/gamification/daily-checkin endpoint). Don't dual-write a
  // prediction-win streak from here. Win streak as a product feature
  // is deferred to a future Predict overhaul.
  await client.query(
    `
      update profiles
      set total_predictions = $2,
          win_rate = $3
      where id = $1
    `,
    [userId, totalPredictions, winRate],
  );

  return { totalPredictions, winRate };
}

async function recalcEntryTotals(
  client: Awaited<ReturnType<typeof pool.connect>>,
  marketIds: string[],
) {
  const totals = await client.query<{ entry_id: string; total_stake: string }>(
    `
      select
        me.id as entry_id,
        coalesce(sum(case when mb.status = 'active' then mb.stake_amount else 0 end), 0)::int as total_stake
      from market_entries me
      left join market_bets mb on mb.entry_id = me.id
      where me.market_id = any($1::text[])
      group by me.id
    `,
    [marketIds],
  );

  for (const row of totals.rows) {
    await client.query(
      `
        update market_entries
        set total_stake = $2
        where id = $1
      `,
      [row.entry_id, Number(row.total_stake)],
    );
  }
}

async function deleteEmptyTestMarkets(
  client: Awaited<ReturnType<typeof pool.connect>>,
  marketIds: string[],
) {
  const markets = await client.query<{ market_id: string; market_title: string; market_slug: string; bet_count: string }>(
    `
      select
        pm.id as market_id,
        pm.title as market_title,
        pm.slug as market_slug,
        count(mb.id)::int as bet_count
      from prediction_markets pm
      left join market_bets mb on mb.market_id = pm.id
      where pm.id = any($1::text[])
      group by pm.id, pm.title, pm.slug
    `,
    [marketIds],
  );

  const deletedMarketIds: string[] = [];
  for (const market of markets.rows) {
    const betCount = Number(market.bet_count);
    const isDisposableTestMarket =
      betCount === 0 && (market.market_title === "[TEST]" || market.market_slug.startsWith("test-"));

    if (!isDisposableTestMarket) continue;

    await client.query(`delete from prediction_markets where id = $1`, [market.market_id]);
    deletedMarketIds.push(market.market_id);
  }

  return deletedMarketIds;
}

async function run() {
  const client = await pool.connect();

  try {
    const targets = await loadTargetBets(client);
    const ledgerRows = await loadLedgerRows(client, targets);

    const ledgerNetByUser = new Map<string, number>();
    for (const row of ledgerRows) {
      ledgerNetByUser.set(row.user_id, (ledgerNetByUser.get(row.user_id) ?? 0) + Number(row.amount));
    }

    const preview = {
      execute: EXECUTE,
      targetBets: targets,
      ledgerRows,
      ledgerNetByUser: Object.fromEntries(ledgerNetByUser),
    };

    console.log("=== REMOVE STALE PREDICTIONS PREVIEW ===");
    console.log(JSON.stringify(preview, null, 2));

    if (!EXECUTE) {
      console.log("\nDry run only. Re-run with --execute to apply changes.");
      return;
    }

    const affectedUserIds = Array.from(new Set(targets.map((target) => target.user_id)));
    const affectedMarketIds = Array.from(new Set(targets.map((target) => target.market_id)));
    const targetBetIds = targets.map((target) => target.bet_id);
    const targetEntryIds = Array.from(new Set(targets.map((target) => target.entry_id)));

    await client.query("begin");

    if (ledgerRows.length > 0) {
      await client.query(`delete from credit_ledger where id = any($1::text[])`, [ledgerRows.map((row) => row.id)]);
    }

    await client.query(`delete from market_bets where id = any($1::text[])`, [targetBetIds]);

    await recalcEntryTotals(client, affectedMarketIds);

    for (const userId of affectedUserIds) {
      const ledgerNet = ledgerNetByUser.get(userId) ?? 0;
      if (ledgerNet !== 0) {
        await client.query(
          `
            update profiles
            set predict_credits = predict_credits - $2
            where id = $1
          `,
          [userId, ledgerNet],
        );
      }

      await recomputeProfileStats(client, userId);
    }

    const deletedMarketIds = await deleteEmptyTestMarkets(client, affectedMarketIds);

    await client.query("commit");

    const verification = await client.query(
      `
        select
          p.username,
          p.predict_credits,
          p.total_predictions,
          p.win_rate
        from profiles p
        where p.id = any($1::text[])
        order by p.username
      `,
      [affectedUserIds],
    );

    const betCheck = await client.query(
      `
        select count(*)::int as remaining_targets
        from market_bets
        where id = any($1::text[])
      `,
      [targetBetIds],
    );

    const marketCheck = await client.query(
      `
        select
          pm.id,
          pm.title,
          pm.visibility,
          count(mb.id)::int as remaining_bets
        from prediction_markets pm
        left join market_bets mb on mb.market_id = pm.id
        where pm.id = any($1::text[])
        group by pm.id, pm.title, pm.visibility
        order by pm.title
      `,
      [affectedMarketIds.filter((marketId) => !deletedMarketIds.includes(marketId))],
    );

    const entryCheck = await client.query(
      `
        select id, market_id, label, total_stake
        from market_entries
        where id = any($1::text[])
        order by market_id, label
      `,
      [targetEntryIds],
    );

    console.log("\n=== CLEANUP APPLIED ===");
    console.log(
      JSON.stringify(
        {
          deletedBetIds: targetBetIds,
          deletedLedgerIds: ledgerRows.map((row) => row.id),
          deletedMarketIds,
          remainingTargets: Number(betCheck.rows[0]?.remaining_targets ?? 0),
          profiles: verification.rows,
          survivingMarkets: marketCheck.rows,
          survivingEntries: entryCheck.rows,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // no-op
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Failed to remove stale predictions:", error);
  process.exit(1);
});
