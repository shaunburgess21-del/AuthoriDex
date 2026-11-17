/**
 * Rescale every stored trend score from the legacy x10,000 scale to the
 * x1,000 scale (divide by 10, round) — e.g. 791,349 becomes 79,135.
 *
 * This is the DATA half of the Nov 2026 rescale. The CODE half is
 * `server/scoring/scale.ts` (+ the constants that reference it). They must
 * land together, in this order:
 *
 *   1. Pause agents            (admin → Agents tab → master toggle)
 *   2. Deploy the new code     (ingest now refuses to run on legacy-scale data,
 *                               so nothing can blend the two scales)
 *   3. Run this script         npx tsx --env-file=.env ops/rescale-scores-div10.ts --apply
 *   4. Restart the backend     (clears in-process caches holding old-scale scores)
 *   5. Unpause agents, check the leaderboard and the next hourly ingest
 *
 * Never roll the code back after step 3 without restoring the data first:
 * old code has no scale guard and would blend scales on its next ingest.
 *
 * What it changes (all inside ONE transaction — it either fully applies or
 * fully rolls back):
 *
 *   trend_snapshots         fame_index, trend_score          (full history)
 *   trending_people         fame_index, fame_index_live, trend_score
 *   celebrity_metrics       fame_index, trend_score
 *   prediction_markets      baseline_score, metadata.openingScore(s), and the
 *                           score fields inside resolution_notes
 *   market_bets             bet_metadata.predictedScore      (jackpot tickets)
 *   scheduled_agent_actions decision_payload.predictedScore  (jackpot_bet)
 *   credit_ledger           metadata.predictedScore / actualScore / margin
 *                           (display metadata only — amounts are never touched)
 *   notifications           metadata scores + the scores quoted in jackpot bodies
 *   api_cache               deletes cached insights payloads (they re-warm)
 *
 * Not changed: credits, payouts, prices, percentages, ranks, raw provider
 * inputs, free-text prose (agent reasoning, admin audit log). By default
 * `trend_snapshots.diagnostics.stab.rawFame` is left alone too — nothing reads
 * it, and rewriting it means rewriting ~1 GB of TOAST. Pass
 * --include-diagnostics if you want it rescaled anyway.
 *
 * Safety:
 *   - Default mode is a DRY RUN inside a READ ONLY transaction: it cannot
 *     write. It evaluates every update expression against every real row,
 *     plans every statement, and prints what would change.
 *   - --apply refuses to run unless the data is still on the legacy scale, no
 *     backup schema exists yet (so it cannot run twice), agents are paused,
 *     no ingest is mid-run, and the new code is confirmed deployed (either a
 *     blocked-ingest record written by the new scale guard, or --code-deployed).
 *   - Original values are copied to the `score_rescale_backup` schema first.
 *     Each backup table is the primary key plus the original columns, so an
 *     undo is one `UPDATE … FROM score_rescale_backup.<table>` per table —
 *     valid only until the next ingest writes new-scale rows. Once you are
 *     happy: DROP SCHEMA score_rescale_backup CASCADE;
 *   - Every change is verified against the backup before COMMIT; any mismatch
 *     rolls the whole thing back.
 *
 * While --apply runs (a couple of minutes) writes to the affected tables wait;
 * reads are unaffected.
 *
 * Run:
 *   npx tsx --env-file=.env ops/rescale-scores-div10.ts                 (dry run)
 *   npx tsx --env-file=.env ops/rescale-scores-div10.ts --apply
 *   npx tsx --env-file=.env ops/rescale-scores-div10.ts --apply --code-deployed
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { JACKPOT_MAX_PREDICTED_SCORE } from "../server/config/constants";
import { FAME_INDEX_MAX, MIN_PLAUSIBLE_AVG_FAME_INDEX, isLegacyFameScale } from "../server/scoring/scale";
import {
  assignActiveTicketScores,
  isNativeMarketType,
  rescaleJackpotNotificationBody,
  rescaleResolutionNotes,
  type ActiveTicket,
  type TicketAssignment,
} from "./score-rescale-lib";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const KNOWN_FLAGS = new Set(["--apply", "--dry-run", "--code-deployed", "--include-diagnostics"]);
const APPLY = args.includes("--apply");
const CODE_DEPLOYED = args.includes("--code-deployed");
const INCLUDE_DIAGNOSTICS = args.includes("--include-diagnostics");

const BACKUP = "score_rescale_backup";
const NATIVE_TYPES = "('updown','h2h','gainer','jackpot')";
const SCALE_GUARD_ERROR_PREFIX = "Score scale mismatch";
const BATCH = 500;

/**
 * Advisory keys from the registry in server/db.ts. Every job below takes its
 * key with pg_try_advisory_lock and simply skips the tick when it is busy, so
 * holding them for the duration of the migration makes those jobs sit out
 * cleanly instead of reading old-scale values and writing them back after.
 */
const JOB_LOCKS: ReadonlyArray<{ key: number; job: string }> = [
  { key: 12_345, job: "ingest leaderboard write" },
  { key: 5_201, job: "agent runner" },
  { key: 5_202, job: "market resolver" },
  { key: 5_203, job: "live tick" },
  { key: 5_204, job: "market generator" },
  { key: 5_208, job: "notifications derivation" },
];

/** Writers to these wait until COMMIT, so no row can slip in un-rescaled mid-run. */
const LOCKED_TABLES = [
  "public.trend_snapshots",
  "public.trending_people",
  "public.celebrity_metrics",
  "public.prediction_markets",
  "public.market_bets",
  "public.scheduled_agent_actions",
];

// ───────────────────────────────────────────────────────────────────────────
// SQL building blocks
// ───────────────────────────────────────────────────────────────────────────

/** round(x / 10) on numeric — half away from zero, same as rescaleScore() in the lib. */
const d10 = (expr: string): string => `round((${expr})::numeric / 10)`;
const isNum = (col: string, key: string): string => `jsonb_typeof(${col} -> '${key}') = 'number'`;
const anyNum = (col: string, keys: readonly string[]): string =>
  `(${keys.map((k) => isNum(col, k)).join(" OR ")})`;

/** `{ key: rescaled }` when the key holds a number, `{}` otherwise — for `col || patch`. */
const keyPatch = (col: string, key: string): string =>
  `CASE WHEN ${isNum(col, key)} THEN jsonb_build_object('${key}', ${d10(`${col} ->> '${key}'`)}) ELSE '{}'::jsonb END`;

/**
 * Margin is |predicted − actual|. When the stored margin is consistent with
 * its sources, recompute it from the rescaled sources so the three numbers
 * still add up; otherwise rescale it directly. Mirrors rescaleDerived().
 */
const marginPatch = (col: string): string => `CASE WHEN ${isNum(col, "margin")} THEN jsonb_build_object('margin',
      CASE WHEN ${isNum(col, "predictedScore")} AND ${isNum(col, "actualScore")} THEN
        CASE WHEN (${col} ->> 'margin')::numeric = abs((${col} ->> 'predictedScore')::numeric - (${col} ->> 'actualScore')::numeric)
          THEN abs(${d10(`${col} ->> 'predictedScore'`)} - ${d10(`${col} ->> 'actualScore'`)})
          ELSE ${d10(`${col} ->> 'margin'`)} END
      ELSE ${d10(`${col} ->> 'margin'`)} END)
    ELSE '{}'::jsonb END`;

const keysArray = (keys: readonly string[]): string => `ARRAY[${keys.map((k) => `'${k}'`).join(", ")}]`;

/** True when a plain rescaled key in the live row does not match round(backup / 10). */
const keyMismatch = (live: string, backup: string, key: string): string =>
  `CASE WHEN ${isNum(backup, key)} THEN (CASE WHEN ${isNum(live, key)} THEN (${live} ->> '${key}')::numeric IS DISTINCT FROM ${d10(`${backup} ->> '${key}'`)} ELSE true END) ELSE false END`;

/** metadata.openingScore.score (updown) + metadata.openingScores[].score (h2h / gainer). */
const marketMetadataExpr = (col: string): string => `(
      SELECT CASE WHEN jsonb_typeof(s.m -> 'openingScores') = 'array' THEN
        jsonb_set(s.m, '{openingScores}', (
          SELECT coalesce(jsonb_agg(
            CASE WHEN jsonb_typeof(a.e -> 'score') = 'number'
              THEN jsonb_set(a.e, '{score}', to_jsonb(${d10("a.e ->> 'score'")}))
              ELSE a.e END
            ORDER BY a.ord), '[]'::jsonb)
          FROM jsonb_array_elements(s.m -> 'openingScores') WITH ORDINALITY AS a(e, ord)))
      ELSE s.m END
      FROM (
        SELECT CASE WHEN jsonb_typeof(${col} #> '{openingScore,score}') = 'number'
          THEN jsonb_set(${col}, '{openingScore,score}', to_jsonb(${d10(`${col} #>> '{openingScore,score}'`)}))
          ELSE ${col} END AS m
      ) s
    )`;

const marketHasOpening = (alias: string): string =>
  `(${alias}.market_type IN ${NATIVE_TYPES} AND (jsonb_typeof(${alias}.metadata #> '{openingScore,score}') = 'number' OR jsonb_typeof(${alias}.metadata -> 'openingScores') = 'array'))`;

interface SqlStep {
  name: string;
  table: string;
  alias: string;
  where: string;
  sets: Array<{ column: string; expr: string }>;
  /** `CREATE TABLE score_rescale_backup.<name> AS <select>`; the select doubles as a stand-in for the backup in dry runs. */
  backup: { name: string; select: string } | null;
  /** Given a reference to the backup relation, returns SQL yielding `n` = rows that are wrong. */
  verify: ((backupRef: string) => string) | null;
}

function updateSql(step: SqlStep): string {
  return `UPDATE ${step.table} AS ${step.alias} SET ${step.sets.map((s) => `${s.column} = ${s.expr}`).join(", ")} WHERE ${step.where}`;
}

/** Evaluates every SET expression over every target row without writing anything. */
function previewSql(step: SqlStep): string {
  const evaluated = step.sets.map((s) => `length(coalesce((${s.expr})::text, ''))`).join(" + ");
  return `SELECT count(*)::int AS n, coalesce(sum(${evaluated}), 0)::bigint AS evaluated FROM ${step.table} AS ${step.alias} WHERE ${step.where}`;
}

const LEDGER_KEYS = ["predictedScore", "actualScore"] as const;
const NOTIFICATION_KEYS = ["actualScore", "predictedScore", "currentScore", "priorScore"] as const;
const SETTLED_TICKET = `NOT (mb.action_type = 'parimutuel' AND mb.status = 'active')`;

function buildSqlSteps(): SqlStep[] {
  const snapshotSets = [
    { column: "fame_index", expr: `${d10("ts.fame_index")}::int` },
    { column: "trend_score", expr: `${d10("ts.trend_score::float8")}::real` },
  ];
  if (INCLUDE_DIAGNOSTICS) {
    snapshotSets.push({
      column: "diagnostics",
      expr: `CASE WHEN jsonb_typeof(ts.diagnostics #> '{stab,rawFame}') = 'number'
        THEN jsonb_set(ts.diagnostics, '{stab,rawFame}', to_jsonb(${d10("ts.diagnostics #>> '{stab,rawFame}'")}))
        ELSE ts.diagnostics END`,
    });
  }

  return [
    {
      name: "trend_snapshots",
      table: "public.trend_snapshots",
      alias: "ts",
      where: "true",
      sets: snapshotSets,
      backup: {
        name: "trend_snapshots",
        select: `SELECT id, fame_index, trend_score${INCLUDE_DIAGNOSTICS ? ", diagnostics #> '{stab,rawFame}' AS raw_fame" : ""} FROM public.trend_snapshots`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.trend_snapshots t ON t.id = b.id
        WHERE t.id IS NULL
           OR t.fame_index IS DISTINCT FROM ${d10("b.fame_index")}::int
           OR t.trend_score IS DISTINCT FROM ${d10("b.trend_score::float8")}::real${
             INCLUDE_DIAGNOSTICS
               ? `
           OR (jsonb_typeof(b.raw_fame) = 'number' AND (t.diagnostics #>> '{stab,rawFame}')::numeric IS DISTINCT FROM ${d10("b.raw_fame #>> '{}'")})`
               : ""
           }`,
    },
    {
      name: "trending_people",
      table: "public.trending_people",
      alias: "tp",
      where: "true",
      sets: [
        { column: "fame_index", expr: `${d10("tp.fame_index")}::int` },
        { column: "fame_index_live", expr: `${d10("tp.fame_index_live")}::int` },
        { column: "trend_score", expr: `${d10("tp.trend_score::float8")}::real` },
      ],
      backup: {
        name: "trending_people",
        select: `SELECT id, fame_index, fame_index_live, trend_score FROM public.trending_people`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.trending_people t ON t.id = b.id
        WHERE t.id IS NULL
           OR t.fame_index IS DISTINCT FROM ${d10("b.fame_index")}::int
           OR t.fame_index_live IS DISTINCT FROM ${d10("b.fame_index_live")}::int
           OR t.trend_score IS DISTINCT FROM ${d10("b.trend_score::float8")}::real`,
    },
    {
      name: "celebrity_metrics",
      table: "public.celebrity_metrics",
      alias: "cm",
      where: "true",
      sets: [
        { column: "fame_index", expr: `${d10("cm.fame_index")}::int` },
        { column: "trend_score", expr: `${d10("cm.trend_score::float8")}::real` },
      ],
      backup: {
        name: "celebrity_metrics",
        select: `SELECT celebrity_id, fame_index, trend_score FROM public.celebrity_metrics`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.celebrity_metrics t ON t.celebrity_id = b.celebrity_id
        WHERE t.celebrity_id IS NULL
           OR t.fame_index IS DISTINCT FROM ${d10("b.fame_index")}::int
           OR t.trend_score IS DISTINCT FROM ${d10("b.trend_score::float8")}::real`,
    },
    {
      name: "prediction_markets (baseline_score, opening scores)",
      table: "public.prediction_markets",
      alias: "pm",
      where: `pm.baseline_score IS NOT NULL OR ${marketHasOpening("pm")}`,
      sets: [
        { column: "baseline_score", expr: `${d10("pm.baseline_score")}::int` },
        {
          column: "metadata",
          expr: `CASE WHEN pm.market_type IN ${NATIVE_TYPES} THEN ${marketMetadataExpr("pm.metadata")} ELSE pm.metadata END`,
        },
      ],
      backup: {
        name: "prediction_markets",
        // Superset: also covers the resolution_notes rewrite done in JS below.
        select: `SELECT id, market_type, baseline_score, metadata, resolution_notes FROM public.prediction_markets pm
          WHERE pm.baseline_score IS NOT NULL OR ${marketHasOpening("pm")}
             OR (pm.market_type IN ${NATIVE_TYPES} AND pm.resolution_notes IS NOT NULL)`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.prediction_markets t ON t.id = b.id
        WHERE t.id IS NULL
           OR t.baseline_score IS DISTINCT FROM ${d10("b.baseline_score")}::int
           OR (t.metadata - ${keysArray(["openingScore", "openingScores"])}) IS DISTINCT FROM (b.metadata - ${keysArray(["openingScore", "openingScores"])})
           OR (CASE WHEN b.market_type IN ${NATIVE_TYPES} AND jsonb_typeof(b.metadata #> '{openingScore,score}') = 'number'
                 THEN (t.metadata #>> '{openingScore,score}')::numeric IS DISTINCT FROM ${d10("b.metadata #>> '{openingScore,score}'")}
                   OR (t.metadata -> 'openingScore') - 'score' IS DISTINCT FROM (b.metadata -> 'openingScore') - 'score'
                 ELSE (t.metadata -> 'openingScore') IS DISTINCT FROM (b.metadata -> 'openingScore') END)
           OR (CASE WHEN b.market_type IN ${NATIVE_TYPES} AND jsonb_typeof(b.metadata -> 'openingScores') = 'array'
                 THEN jsonb_array_length(t.metadata -> 'openingScores') IS DISTINCT FROM jsonb_array_length(b.metadata -> 'openingScores')
                   OR EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(b.metadata -> 'openingScores') WITH ORDINALITY AS x(e, ord)
                     LEFT JOIN jsonb_array_elements(t.metadata -> 'openingScores') WITH ORDINALITY AS y(e, ord) ON y.ord = x.ord
                     WHERE CASE WHEN jsonb_typeof(x.e -> 'score') = 'number'
                       THEN (y.e ->> 'score')::numeric IS DISTINCT FROM ${d10("x.e ->> 'score'")}
                         OR (y.e - 'score') IS DISTINCT FROM (x.e - 'score')
                       ELSE y.e IS DISTINCT FROM x.e END)
                 ELSE (t.metadata -> 'openingScores') IS DISTINCT FROM (b.metadata -> 'openingScores') END)`,
    },
    {
      name: "market_bets (settled jackpot tickets)",
      table: "public.market_bets",
      alias: "mb",
      where: `${isNum("mb.bet_metadata", "predictedScore")} AND ${SETTLED_TICKET}`,
      sets: [{ column: "bet_metadata", expr: `mb.bet_metadata || ${keyPatch("mb.bet_metadata", "predictedScore")}` }],
      backup: {
        name: "market_bets",
        // Superset: also covers the active tickets reassigned in JS below.
        select: `SELECT id, market_id, user_id, action_type, status, bet_metadata FROM public.market_bets WHERE bet_metadata ? 'predictedScore'`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.market_bets t ON t.id = b.id
        WHERE NOT (b.action_type = 'parimutuel' AND b.status = 'active')
          AND (t.id IS NULL
            OR (t.bet_metadata - 'predictedScore') IS DISTINCT FROM (b.bet_metadata - 'predictedScore')
            OR ${keyMismatch("t.bet_metadata", "b.bet_metadata", "predictedScore")})`,
    },
    {
      name: "scheduled_agent_actions (jackpot_bet)",
      table: "public.scheduled_agent_actions",
      alias: "sa",
      where: `sa.action_type = 'jackpot_bet' AND ${isNum("sa.decision_payload", "predictedScore")}`,
      sets: [
        { column: "decision_payload", expr: `sa.decision_payload || ${keyPatch("sa.decision_payload", "predictedScore")}` },
      ],
      backup: {
        name: "scheduled_agent_actions",
        select: `SELECT id, status, decision_payload FROM public.scheduled_agent_actions sa
          WHERE sa.action_type = 'jackpot_bet' AND ${isNum("sa.decision_payload", "predictedScore")}`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.scheduled_agent_actions t ON t.id = b.id
        WHERE t.id IS NULL
           OR (t.decision_payload - 'predictedScore') IS DISTINCT FROM (b.decision_payload - 'predictedScore')
           OR ${keyMismatch("t.decision_payload", "b.decision_payload", "predictedScore")}`,
    },
    {
      name: "credit_ledger (jackpot display metadata)",
      table: "public.credit_ledger",
      alias: "cl",
      where: `cl.txn_type::text IN ('prediction_stake', 'prediction_payout') AND ${anyNum("cl.metadata", LEDGER_KEYS)}`,
      sets: [
        {
          column: "metadata",
          expr: `cl.metadata || ${LEDGER_KEYS.map((k) => keyPatch("cl.metadata", k)).join(" || ")} || ${marginPatch("cl.metadata")}`,
        },
      ],
      backup: {
        name: "credit_ledger",
        select: `SELECT id, txn_type::text AS txn_type, metadata FROM public.credit_ledger cl
          WHERE cl.txn_type::text IN ('prediction_stake', 'prediction_payout') AND ${anyNum("cl.metadata", LEDGER_KEYS)}`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.credit_ledger t ON t.id = b.id
        WHERE t.id IS NULL
           OR (t.metadata - ${keysArray([...LEDGER_KEYS, "margin"])}) IS DISTINCT FROM (b.metadata - ${keysArray([...LEDGER_KEYS, "margin"])})
           OR (${isNum("b.metadata", "margin")}) IS DISTINCT FROM (${isNum("t.metadata", "margin")})
           OR ${LEDGER_KEYS.map((k) => keyMismatch("t.metadata", "b.metadata", k)).join("\n           OR ")}`,
    },
    {
      name: "notifications (score metadata)",
      table: "public.notifications",
      alias: "nf",
      where: `nf.kind IN ('market_resolved', 'favorite_hot_mover') AND ${anyNum("nf.metadata", NOTIFICATION_KEYS)}`,
      sets: [
        {
          column: "metadata",
          expr: `nf.metadata || ${NOTIFICATION_KEYS.map((k) => keyPatch("nf.metadata", k)).join(" || ")} || ${marginPatch("nf.metadata")}`,
        },
      ],
      backup: {
        name: "notifications",
        // Also preserves the original body, rewritten in JS below.
        select: `SELECT id, kind, body, metadata FROM public.notifications nf
          WHERE nf.kind IN ('market_resolved', 'favorite_hot_mover') AND ${anyNum("nf.metadata", NOTIFICATION_KEYS)}`,
      },
      verify: (b) => `SELECT count(*)::int AS n FROM ${b} b LEFT JOIN public.notifications t ON t.id = b.id
        WHERE t.id IS NULL
           OR (t.metadata - ${keysArray([...NOTIFICATION_KEYS, "margin"])}) IS DISTINCT FROM (b.metadata - ${keysArray([...NOTIFICATION_KEYS, "margin"])})
           OR (${isNum("b.metadata", "margin")}) IS DISTINCT FROM (${isNum("t.metadata", "margin")})
           OR ${NOTIFICATION_KEYS.map((k) => keyMismatch("t.metadata", "b.metadata", k)).join("\n           OR ")}`,
    },
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

class Abort extends Error {}

function buildSsl(): { rejectUnauthorized: boolean; ca?: string } {
  // Same policy as server/db.ts.
  const ca = process.env.DATABASE_CA_CERT?.trim();
  const strict = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
  if (strict || ca) return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  return { rejectUnauthorized: false };
}

/** Host / port / database only — never the credentials — so it is obvious which DB this run targets. */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const fmt = (n: number): string => n.toLocaleString("en-US");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(52)} ${typeof value === "number" ? fmt(value) : value}`);
}

async function one<T extends Record<string, unknown>>(client: Client, sql: string, params: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected a row from: ${sql.slice(0, 120)}`);
  return row;
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const row = await one<{ n: number | string }>(client, sql, params);
  return Number(row.n);
}

/** Runs `sql` (which must read its rows from `$1::jsonb`) once per batch; returns rows affected. */
async function runBatched(client: Client, sql: string, rows: readonly object[]): Promise<number> {
  let affected = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const result = await client.query(sql, [JSON.stringify(rows.slice(i, i + BATCH))]);
    affected += result.rowCount ?? 0;
  }
  return affected;
}

// ───────────────────────────────────────────────────────────────────────────
// Preflight
// ───────────────────────────────────────────────────────────────────────────

interface Preflight {
  maxFameIndex: number | null;
  avgFameIndex: number | null;
  people: number;
  legacyScale: boolean;
  backupExists: boolean;
  runningIngests: number;
  agentsPaused: boolean;
  guardEvidence: boolean;
  lastRun: { status: string; startedAt: string | null; errorSummary: string | null } | null;
  badTickets: number;
  openMarkets: number;
}

async function preflight(client: Client): Promise<Preflight> {
  const scale = await one<{ max: number | null; avg: string | null; n: number }>(
    client,
    `SELECT max(fame_index) AS max, avg(fame_index) AS avg, count(*)::int AS n FROM public.trending_people`,
  );
  const backupExists =
    (await count(client, `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1`, [BACKUP])) > 0;
  const runningIngests = await count(
    client,
    `SELECT count(*)::int AS n FROM public.ingestion_runs WHERE status = 'running'`,
  );
  const paused = await client.query<{ paused: boolean }>(
    `SELECT paused FROM public.agent_runtime_state WHERE id = 'global'`,
  );
  // started_at is a naive UTC timestamp; format it in SQL so the driver does
  // not reinterpret it in this machine's local timezone.
  const lastRunResult = await client.query<{ status: string; started_at: string | null; error_summary: string | null }>(
    `SELECT status::text AS status, to_char(started_at, 'YYYY-MM-DD HH24:MI') || ' UTC' AS started_at, error_summary
     FROM public.ingestion_runs r
     WHERE status::text <> 'locked_out' ORDER BY r.started_at DESC LIMIT 1`,
  );
  const lastRunRow = lastRunResult.rows[0];
  // A jackpot ticket whose number is not a whole JSON number would be skipped
  // by the rescale and left on the old scale — refuse rather than half-migrate.
  const badTickets = await count(
    client,
    `SELECT count(*)::int AS n FROM public.market_bets
     WHERE bet_metadata ? 'predictedScore'
       AND (CASE WHEN jsonb_typeof(bet_metadata -> 'predictedScore') = 'number'
              THEN (bet_metadata ->> 'predictedScore')::numeric <> trunc((bet_metadata ->> 'predictedScore')::numeric)
              ELSE true END)`,
  );
  const openMarkets = await count(
    client,
    `SELECT count(*)::int AS n FROM public.prediction_markets WHERE status = 'OPEN' AND market_type IN ${NATIVE_TYPES}`,
  );

  const maxFameIndex = scale.max == null ? null : Number(scale.max);
  return {
    maxFameIndex,
    avgFameIndex: scale.avg == null ? null : Number(scale.avg),
    people: scale.n,
    legacyScale: isLegacyFameScale(maxFameIndex),
    backupExists,
    runningIngests,
    agentsPaused: paused.rows[0]?.paused === true,
    guardEvidence: lastRunRow?.error_summary?.startsWith(SCALE_GUARD_ERROR_PREFIX) === true,
    lastRun: lastRunRow
      ? {
          status: lastRunRow.status,
          startedAt: lastRunRow.started_at,
          errorSummary: lastRunRow.error_summary,
        }
      : null,
    badTickets,
    openMarkets,
  };
}

function printPreflight(p: Preflight): void {
  console.log("\nPreflight");
  line("leaderboard rows", p.people);
  line("stored max fame_index", p.maxFameIndex == null ? "(none)" : fmt(p.maxFameIndex));
  line("stored avg fame_index", p.avgFameIndex == null ? "(none)" : fmt(Math.round(p.avgFameIndex)));
  line("scale", p.legacyScale ? "LEGACY (x10,000) — needs rescale" : "already on the new scale");
  line("backup schema already exists", p.backupExists ? "YES" : "no");
  line("ingest currently running", p.runningIngests > 0 ? "YES" : "no");
  line("agents paused", p.agentsPaused ? "yes" : "NO");
  line(
    "new code deployed (scale guard has blocked an ingest)",
    p.guardEvidence ? "yes" : CODE_DEPLOYED ? "not seen — asserted via --code-deployed" : "NOT SEEN",
  );
  if (p.lastRun) {
    line("last ingest run", `${p.lastRun.status} @ ${p.lastRun.startedAt ?? "?"}`);
  }
  line("jackpot tickets with a non-integer number", p.badTickets);
  line("open native markets (handled in place)", p.openMarkets);
}

/** Reasons --apply must not proceed. Empty = good to go. */
function blockers(p: Preflight): string[] {
  const reasons: string[] = [];
  if (!p.legacyScale) {
    reasons.push(
      `Stored max fame_index is ${p.maxFameIndex ?? "(none)"} (<= ${FAME_INDEX_MAX}): the data is already on the new scale. Running again would divide it a second time.`,
    );
  }
  if (p.backupExists) {
    reasons.push(
      `Schema "${BACKUP}" already exists — the rescale has been applied before. Inspect it; drop it only once you are sure.`,
    );
  }
  if (p.runningIngests > 0) {
    reasons.push("An ingest is mid-run. Wait for it to finish (it starts at :02 and takes ~6 minutes).");
  }
  if (!p.agentsPaused) {
    reasons.push("Agents are not paused. Pause them first (admin → Agents tab → master toggle).");
  }
  if (!p.guardEvidence && !CODE_DEPLOYED) {
    reasons.push(
      "No sign that the new code is deployed: the latest ingest run was not blocked by the scale guard. " +
        "Old code would blend scales on its next ingest. Deploy first; then either wait for one blocked ingest " +
        "or pass --code-deployed if you have confirmed the deploy yourself.",
    );
  }
  if (p.badTickets > 0) {
    reasons.push(`${p.badTickets} jackpot ticket(s) hold a non-integer number and would be left on the old scale.`);
  }
  return reasons;
}

// ───────────────────────────────────────────────────────────────────────────
// JS-computed plans (things SQL alone cannot do safely)
// ───────────────────────────────────────────────────────────────────────────

interface NotesPlan {
  rows: Array<{ id: string; notes: string }>;
  scanned: number;
  fields: number;
  reformatted: number;
  skipped: Array<{ id: string; reason: string }>;
  sample: { id: string; before: string; after: string } | null;
}

async function planResolutionNotes(client: Client): Promise<NotesPlan> {
  const result = await client.query<{ id: string; market_type: string; resolution_notes: string }>(
    `SELECT id, market_type, resolution_notes FROM public.prediction_markets
     WHERE market_type IN ${NATIVE_TYPES} AND resolution_notes IS NOT NULL`,
  );
  const plan: NotesPlan = { rows: [], scanned: result.rows.length, fields: 0, reformatted: 0, skipped: [], sample: null };
  for (const row of result.rows) {
    if (!isNativeMarketType(row.market_type)) continue;
    const out = rescaleResolutionNotes(row.market_type, row.resolution_notes);
    if (out.skipped) {
      plan.skipped.push({ id: row.id, reason: out.skipped });
      continue;
    }
    if (out.changedFields === 0) continue;
    plan.rows.push({ id: row.id, notes: out.text });
    plan.fields += out.changedFields;
    if (out.reformatted) plan.reformatted++;
    if (!plan.sample) plan.sample = { id: row.id, before: row.resolution_notes, after: out.text };
  }
  return plan;
}

interface TicketPlan {
  assignments: TicketAssignment[];
  nudged: TicketAssignment[];
  humans: number;
  markets: number;
}

async function planActiveTickets(client: Client): Promise<TicketPlan> {
  const result = await client.query<{
    id: string;
    market_id: string;
    predicted: string;
    is_agent: boolean;
    created_at: Date;
  }>(
    `SELECT mb.id, mb.market_id, (mb.bet_metadata ->> 'predictedScore') AS predicted,
            (mb.agent_id IS NOT NULL OR coalesce(p.is_agent, false)) AS is_agent, mb.created_at
     FROM public.market_bets mb
     LEFT JOIN public.profiles p ON p.id = mb.user_id
     WHERE mb.action_type = 'parimutuel' AND mb.status = 'active'
       AND jsonb_typeof(mb.bet_metadata -> 'predictedScore') = 'number'`,
  );
  const tickets: ActiveTicket[] = result.rows.map((row) => ({
    id: row.id,
    marketId: row.market_id,
    predictedScore: Number(row.predicted),
    isAgent: row.is_agent,
    createdAt: row.created_at.getTime(),
  }));
  const assignments = assignActiveTicketScores(tickets, JACKPOT_MAX_PREDICTED_SCORE);
  return {
    assignments,
    nudged: assignments.filter((a) => a.nudge !== 0),
    humans: tickets.filter((t) => !t.isAgent).length,
    markets: new Set(tickets.map((t) => t.marketId)).size,
  };
}

interface BodyPlan {
  rows: Array<{ id: string; body: string }>;
  scanned: number;
  misses: Record<string, number>;
  sample: { before: string; after: string } | null;
}

async function planNotificationBodies(client: Client): Promise<BodyPlan> {
  const result = await client.query<{ id: string; body: string; metadata: unknown }>(
    `SELECT id, body, metadata FROM public.notifications nf
     WHERE nf.kind = 'market_resolved' AND nf.body IS NOT NULL AND ${isNum("nf.metadata", "actualScore")}`,
  );
  const plan: BodyPlan = { rows: [], scanned: result.rows.length, misses: {}, sample: null };
  for (const row of result.rows) {
    const out = rescaleJackpotNotificationBody(row.body, row.metadata);
    for (const miss of out.misses) plan.misses[miss] = (plan.misses[miss] ?? 0) + 1;
    if (out.replacements === 0 || out.body === row.body) continue;
    plan.rows.push({ id: row.id, body: out.body });
    // Prefer showing a body that quotes all three numbers.
    if (!plan.sample || (!plan.sample.before.includes("You predicted") && row.body.includes("You predicted"))) {
      plan.sample = { before: row.body, after: out.body };
    }
  }
  return plan;
}

const UPDATE_NOTES_SQL = `UPDATE public.prediction_markets pm SET resolution_notes = v.notes
  FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, notes text) WHERE pm.id = v.id`;
const UPDATE_TICKET_SQL = `UPDATE public.market_bets mb
  SET bet_metadata = jsonb_set(mb.bet_metadata, '{predictedScore}', to_jsonb(v.score))
  FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, score int) WHERE mb.id = v.id`;
const UPDATE_BODY_SQL = `UPDATE public.notifications nf SET body = v.body
  FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, body text) WHERE nf.id = v.id`;
const DELETE_CACHE_SQL = `DELETE FROM public.api_cache WHERE provider LIKE 'insights\\_%'`;
const COUNT_CACHE_SQL = `SELECT count(*)::int AS n FROM public.api_cache WHERE provider LIKE 'insights\\_%'`;

// Post-update checks for the JS-driven rewrites. Each yields `n` = rows that are wrong.
const VERIFY_NOTES_SQL = `SELECT count(*)::int AS n FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, notes text)
  LEFT JOIN public.prediction_markets pm ON pm.id = v.id WHERE pm.resolution_notes IS DISTINCT FROM v.notes`;
const VERIFY_BODY_SQL = `SELECT count(*)::int AS n FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, body text)
  LEFT JOIN public.notifications nf ON nf.id = v.id WHERE nf.body IS DISTINCT FROM v.body`;
const verifyTicketsSql = (backupRef: string): string => `SELECT count(*)::int AS n
  FROM jsonb_to_recordset($1::jsonb) AS v(id varchar, score int)
  LEFT JOIN public.market_bets mb ON mb.id = v.id
  LEFT JOIN ${backupRef} b ON b.id = v.id
  WHERE mb.id IS NULL OR b.id IS NULL
     OR (mb.bet_metadata ->> 'predictedScore')::numeric IS DISTINCT FROM v.score
     OR (mb.bet_metadata - 'predictedScore') IS DISTINCT FROM (b.bet_metadata - 'predictedScore')`;
/** Any jackpot ticket whose metadata is byte-identical to its backup was missed (0 → 0 aside). */
const untouchedTicketsSql = (backupRef: string): string => `SELECT count(*)::int AS n
  FROM public.market_bets mb JOIN ${backupRef} b ON b.id = mb.id
  WHERE mb.bet_metadata = b.bet_metadata AND (b.bet_metadata ->> 'predictedScore')::numeric <> 0`;
const AFTER_STATE_SQL = `SELECT (SELECT max(fame_index) FROM public.trending_people) AS max,
  (SELECT avg(fame_index) FROM public.trending_people) AS avg,
  (SELECT max(fame_index) FROM public.trend_snapshots) AS snap_max,
  (SELECT max(baseline_score) FROM public.prediction_markets) AS base_max`;

function printPlans(notes: NotesPlan, tickets: TicketPlan, bodies: BodyPlan): void {
  console.log("\nResolution notes (prediction_markets.resolution_notes)");
  line("native markets with notes", notes.scanned);
  line("rows to rewrite", notes.rows.length);
  line("score fields rewritten", notes.fields);
  line("rows re-serialised (non-standard JSON spacing)", notes.reformatted);
  line("rows skipped (not a JSON object)", notes.skipped.length);
  if (notes.sample) {
    console.log(`    e.g. ${notes.sample.id.slice(0, 8)}`);
    console.log(`      before  ${notes.sample.before.slice(0, 220)}`);
    console.log(`      after   ${notes.sample.after.slice(0, 220)}`);
  }

  console.log("\nActive jackpot tickets (market_bets, status = active)");
  line("tickets", tickets.assignments.length);
  line("markets", tickets.markets);
  line("held by humans", tickets.humans);
  line("moved off a rounding collision", tickets.nudged.length);
  for (const a of tickets.nudged) {
    console.log(
      `    market ${a.marketId.slice(0, 8)}  ticket ${a.id.slice(0, 8)}  ${fmt(a.oldScore)} → ${fmt(a.newScore)} (${a.nudge > 0 ? "+" : ""}${a.nudge} vs plain rounding)`,
    );
  }

  console.log("\nJackpot notification text (notifications.body)");
  line("notifications scanned", bodies.scanned);
  line("bodies to rewrite", bodies.rows.length);
  for (const [key, n] of Object.entries(bodies.misses)) {
    line(`  ${key} in metadata but not quoted in body`, n);
  }
  if (bodies.sample) {
    console.log(`      before  ${bodies.sample.before}`);
    console.log(`      after   ${bodies.sample.after}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Dry run
// ───────────────────────────────────────────────────────────────────────────

async function dryRun(client: Client, steps: SqlStep[]): Promise<void> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = 0");

    const p = await preflight(client);
    printPreflight(p);

    console.log("\nBulk updates (every expression evaluated against every row, nothing written)");
    for (const step of steps) {
      const preview = await one<{ n: number; evaluated: string }>(client, previewSql(step));
      // Planning each statement proves it is valid against the live schema.
      await client.query(`EXPLAIN ${updateSql(step)}`);
      if (step.backup) await client.query(`EXPLAIN ${step.backup.select}`);
      if (step.verify && step.backup) await client.query(`EXPLAIN ${step.verify(`(${step.backup.select})`)}`);
      line(step.name, `${fmt(Number(preview.n))} rows`);
    }

    const notes = await planResolutionNotes(client);
    const tickets = await planActiveTickets(client);
    const bodies = await planNotificationBodies(client);
    printPlans(notes, tickets, bodies);

    // Plan the JS-driven statements with a real one-row payload.
    const probe = async (sql: string, rows: readonly object[]): Promise<void> => {
      await client.query(`EXPLAIN ${sql}`, [JSON.stringify(rows.slice(0, 1))]);
    };
    await probe(UPDATE_NOTES_SQL, notes.rows);
    await probe(UPDATE_TICKET_SQL, tickets.assignments.map((a) => ({ id: a.id, score: a.newScore })));
    await probe(UPDATE_BODY_SQL, bodies.rows);
    await client.query(`EXPLAIN ${DELETE_CACHE_SQL}`);

    // Plan the post-update checks too, with the backup's SELECT standing in for
    // the backup table, so --apply cannot trip over a statement it has never parsed.
    const ticketBackup = steps.find((s) => s.backup?.name === "market_bets")?.backup;
    if (!ticketBackup) throw new Error("market_bets backup step is missing");
    await probe(VERIFY_NOTES_SQL, notes.rows);
    await probe(VERIFY_BODY_SQL, bodies.rows);
    await probe(verifyTicketsSql(`(${ticketBackup.select})`), tickets.assignments.map((a) => ({ id: a.id, score: a.newScore })));
    await client.query(`EXPLAIN ${untouchedTicketsSql(`(${ticketBackup.select})`)}`);
    await client.query(`EXPLAIN ${AFTER_STATE_SQL}`);

    console.log("\nCache");
    line("cached insights payloads to delete (they re-warm)", await count(client, COUNT_CACHE_SQL));

    const sample = await client.query<{ name: string; fame_index: number; after: number }>(
      `SELECT name, fame_index, ${d10("fame_index")}::int AS after FROM public.trending_people
       ORDER BY fame_index DESC NULLS LAST LIMIT 5`,
    );
    console.log("\nLeaderboard preview");
    for (const row of sample.rows) {
      console.log(`    ${row.name.padEnd(28)} ${fmt(row.fame_index).padStart(9)}  →  ${fmt(row.after).padStart(7)}`);
    }

    const after = await one<{ max: number | null; avg: string | null; snap_max: number | null }>(
      client,
      `SELECT (SELECT max(${d10("fame_index")}::int) FROM public.trending_people) AS max,
              (SELECT avg(${d10("fame_index")}::int) FROM public.trending_people) AS avg,
              (SELECT max(${d10("fame_index")}::int) FROM public.trend_snapshots) AS snap_max`,
    );
    console.log("\nAfter the rescale");
    line("leaderboard max fame_index", after.max == null ? "(none)" : fmt(Number(after.max)));
    line("leaderboard avg fame_index", after.avg == null ? "(none)" : fmt(Math.round(Number(after.avg))));
    line("history max fame_index", after.snap_max == null ? "(none)" : fmt(Number(after.snap_max)));
    line("engine ceiling / ingest sanity floor", `${fmt(FAME_INDEX_MAX)} / ${fmt(MIN_PLAUSIBLE_AVG_FAME_INDEX)}`);

    const reasons = blockers(p);
    console.log("\nDRY RUN complete — nothing was written.");
    if (reasons.length === 0) {
      console.log("--apply would proceed right now.");
    } else {
      console.log("--apply would currently refuse, because:");
      for (const reason of reasons) console.log(`  - ${reason}`);
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Apply
// ───────────────────────────────────────────────────────────────────────────

async function takeJobLocks(client: Client): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (const lock of JOB_LOCKS) {
    for (;;) {
      const row = await one<{ locked: boolean }>(
        client,
        `SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`,
        [lock.key],
      );
      if (row.locked) break;
      if (Date.now() > deadline) {
        throw new Abort(`The ${lock.job} job is mid-run (advisory lock ${lock.key} is held). Try again in a minute.`);
      }
      await sleep(1_000);
    }
  }
}

function expectRows(what: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Abort(`${what}: expected to change ${fmt(expected)} rows but changed ${fmt(actual)}.`);
  }
}

async function apply(client: Client, steps: SqlStep[]): Promise<void> {
  const startedAt = Date.now();
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
    await client.query("SET LOCAL lock_timeout = '20s'");

    console.log("\nLocking out background jobs and writers…");
    await takeJobLocks(client);
    await client.query(`LOCK TABLE ${LOCKED_TABLES.join(", ")} IN SHARE ROW EXCLUSIVE MODE`);

    // Re-check under the locks: this is the state the migration actually sees.
    const p = await preflight(client);
    printPreflight(p);
    const reasons = blockers(p);
    if (reasons.length > 0) {
      throw new Abort(`Refusing to apply:\n${reasons.map((r) => `  - ${r}`).join("\n")}`);
    }

    // Plans are computed from the ORIGINAL values, before any update below.
    const notes = await planResolutionNotes(client);
    const tickets = await planActiveTickets(client);
    const bodies = await planNotificationBodies(client);
    printPlans(notes, tickets, bodies);
    if (notes.skipped.length > 0) {
      throw new Abort(
        `${notes.skipped.length} native market(s) have resolution notes that are not a JSON object (e.g. ${notes.skipped[0].id}).`,
      );
    }

    console.log("\nBacking up original values…");
    await client.query(`CREATE SCHEMA ${BACKUP}`);
    const summary: Record<string, number> = {};
    for (const step of steps) {
      if (!step.backup) continue;
      await client.query(`CREATE TABLE ${BACKUP}.${step.backup.name} AS ${step.backup.select}`);
      line(`${BACKUP}.${step.backup.name}`, await count(client, `SELECT count(*)::int AS n FROM ${BACKUP}.${step.backup.name}`));
    }

    console.log("\nRescaling…");
    for (const step of steps) {
      const expected = await count(client, previewSql(step));
      const result = await client.query(updateSql(step));
      expectRows(step.name, result.rowCount ?? 0, expected);
      summary[step.name] = expected;
      line(step.name, `${fmt(expected)} rows`);
    }

    expectRows("resolution notes", await runBatched(client, UPDATE_NOTES_SQL, notes.rows), notes.rows.length);
    summary["prediction_markets (resolution_notes)"] = notes.rows.length;
    line("prediction_markets (resolution_notes)", `${fmt(notes.rows.length)} rows`);

    // Two passes so no ticket can transiently collide with another ticket's
    // not-yet-rescaled number under the unique (market, number) index.
    const parked = tickets.assignments.map((a, i) => ({ id: a.id, score: -(i + 1) }));
    const finals = tickets.assignments.map((a) => ({ id: a.id, score: a.newScore }));
    expectRows("active tickets (park)", await runBatched(client, UPDATE_TICKET_SQL, parked), parked.length);
    expectRows("active tickets (final)", await runBatched(client, UPDATE_TICKET_SQL, finals), finals.length);
    summary["market_bets (active jackpot tickets)"] = finals.length;
    line("market_bets (active jackpot tickets)", `${fmt(finals.length)} rows`);

    expectRows("notification bodies", await runBatched(client, UPDATE_BODY_SQL, bodies.rows), bodies.rows.length);
    summary["notifications (body)"] = bodies.rows.length;
    line("notifications (body)", `${fmt(bodies.rows.length)} rows`);

    const cache = await client.query(DELETE_CACHE_SQL);
    summary["api_cache (deleted)"] = cache.rowCount ?? 0;
    line("api_cache (deleted)", `${fmt(cache.rowCount ?? 0)} rows`);

    console.log("\nVerifying against the backup…");
    const failures: string[] = [];
    for (const step of steps) {
      if (!step.verify || !step.backup) continue;
      const bad = await count(client, step.verify(`${BACKUP}.${step.backup.name}`));
      line(step.name, bad === 0 ? "ok" : `${fmt(bad)} MISMATCHED`);
      if (bad > 0) failures.push(`${step.name}: ${bad} row(s) do not equal round(original / 10)`);
    }

    const badNotes = await count(client, VERIFY_NOTES_SQL, [JSON.stringify(notes.rows)]);
    line("prediction_markets (resolution_notes)", badNotes === 0 ? "ok" : `${fmt(badNotes)} MISMATCHED`);
    if (badNotes > 0) failures.push(`resolution notes: ${badNotes} row(s) differ from the planned text`);

    const badTickets = await count(client, verifyTicketsSql(`${BACKUP}.market_bets`), [JSON.stringify(finals)]);
    line("market_bets (active jackpot tickets)", badTickets === 0 ? "ok" : `${fmt(badTickets)} MISMATCHED`);
    if (badTickets > 0) failures.push(`active tickets: ${badTickets} row(s) differ from the planned number`);

    const leftover = await count(client, untouchedTicketsSql(`${BACKUP}.market_bets`));
    line("jackpot tickets left untouched", leftover === 0 ? "ok" : `${fmt(leftover)} UNCHANGED`);
    if (leftover > 0) failures.push(`${leftover} jackpot ticket(s) were not rescaled`);

    const badBodies = await count(client, VERIFY_BODY_SQL, [JSON.stringify(bodies.rows)]);
    line("notifications (body)", badBodies === 0 ? "ok" : `${fmt(badBodies)} MISMATCHED`);
    if (badBodies > 0) failures.push(`notification bodies: ${badBodies} row(s) differ from the planned text`);

    const after = await one<{ max: number | null; avg: string | null; snap_max: number | null; base_max: number | null }>(
      client,
      AFTER_STATE_SQL,
    );
    const afterMax = after.max == null ? null : Number(after.max);
    const afterAvg = after.avg == null ? null : Number(after.avg);
    line("leaderboard max / avg fame_index", `${afterMax == null ? "-" : fmt(afterMax)} / ${afterAvg == null ? "-" : fmt(Math.round(afterAvg))}`);
    if (isLegacyFameScale(afterMax)) failures.push(`leaderboard max ${afterMax} is still above ${FAME_INDEX_MAX}`);
    if (isLegacyFameScale(after.snap_max == null ? null : Number(after.snap_max))) {
      failures.push(`history max ${after.snap_max} is still above ${FAME_INDEX_MAX}`);
    }
    if (isLegacyFameScale(after.base_max == null ? null : Number(after.base_max))) {
      failures.push(`a market baseline_score (${after.base_max}) is still above ${FAME_INDEX_MAX}`);
    }
    if (afterAvg != null && afterAvg < MIN_PLAUSIBLE_AVG_FAME_INDEX) {
      failures.push(`leaderboard avg ${Math.round(afterAvg)} is below the ingest sanity floor ${MIN_PLAUSIBLE_AVG_FAME_INDEX}`);
    }

    if (failures.length > 0) {
      throw new Abort(`Verification failed — rolling back:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    }

    await client.query(`CREATE TABLE ${BACKUP}.rescale_run (applied_at timestamptz NOT NULL, include_diagnostics boolean NOT NULL, summary jsonb NOT NULL)`);
    await client.query(`INSERT INTO ${BACKUP}.rescale_run VALUES (now(), $1, $2::jsonb)`, [
      INCLUDE_DIAGNOSTICS,
      JSON.stringify({ rows: summary, nudgedTickets: tickets.nudged }),
    ]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  console.log(`\nAPPLIED and committed in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  console.log("Next:");
  console.log("  1. Restart the backend service (clears in-process caches holding old-scale scores).");
  console.log("  2. Unpause agents and check the leaderboard + the next hourly ingest (:02).");
  console.log(`  3. When you are happy, remove the backup:  DROP SCHEMA ${BACKUP} CASCADE;`);
  console.log("Do not roll the code back without restoring the data first.");
}

async function main(): Promise<void> {
  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}`);
    process.exit(1);
  }
  if (APPLY && args.includes("--dry-run")) {
    console.error("Pass either --apply or --dry-run, not both.");
    process.exit(1);
  }

  console.log("\n[rescale-scores-div10]");
  console.log(`  mode  ${APPLY ? "LIVE APPLY" : "DRY RUN (read-only transaction, no DB writes)"}`);
  if (INCLUDE_DIAGNOSTICS) console.log("  also rescaling trend_snapshots.diagnostics.stab.rawFame");

  if (!process.env.DATABASE_URL) {
    console.error("\nDATABASE_URL is not set.");
    process.exit(1);
  }
  console.log(`  db    ${describeTarget(process.env.DATABASE_URL)}`);

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: buildSsl() });
  await client.connect();
  try {
    const steps = buildSqlSteps();
    if (APPLY) await apply(client, steps);
    else await dryRun(client, steps);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Abort) {
    console.error(`\n${error.message}\n\nNothing was changed.`);
  } else {
    console.error("\nFailed — nothing was changed (the transaction was rolled back).");
    console.error(error);
  }
  process.exit(1);
});
