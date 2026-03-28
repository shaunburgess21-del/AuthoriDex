# Database migrations (AuthoriDex / VoxDex)

This document is the **source of truth** for how we align databases with `shared/schema.ts` when full `drizzle-kit migrate` history is unreliable.

## Approved principles

- **117** is the correct **CSV row count** for `server/data/voxdex_induction_additions.csv` (non-empty lines minus header).
- An **empty Induction Queue** with code deployed was caused by **schema mismatch → API 500**, not by frontend category filters.
- **Idempotent induction columns** (`x_handle`, `induction_status`) stay in the workflow via `server/sql/ensure/001_induction_candidate_columns.sql` and `npm run db:ensure-induction-cols` / `npm run db:ensure`.
- **Do not rely on `npm run db:migrate` alone** for databases with **partial / push-based** history.
- For **future schema changes**: prefer **reviewed additive SQL** in `migrations/` plus **idempotent** snippets under `server/sql/ensure/` when `IF NOT EXISTS` / safe replays are appropriate.

## Generic ensure runner (`db:ensure`)

All idempotent "catch-up" SQL lives in **`server/sql/ensure/`**, sorted lexically:

- `001_induction_candidate_columns.sql` — induction queue columns from migration 0004.
- Add **`002_…sql`**, **`003_…sql`** for future additive fixes (one concern per file is easiest to review).

Commands:

```bash
# Run every .sql file in server/sql/ensure/
npm run db:ensure

# Run only files whose names start with or contain the token (e.g. 001)
npx tsx --env-file=.env server/scripts/run-ensure-schema.ts --only 001
```

`npm run db:ensure-induction-cols` still points at the thin wrapper that applies **only** the `001_…` file (same as `--only 001`).

**CSV import** (`npm run import:induction`) calls `ensureInductionCandidateColumns()` before rows are processed, which runs the same `001` SQL.

## Reality on some environments

Some databases were created or evolved using **`drizzle-kit push`** and ad-hoc SQL instead of a continuous **`drizzle-kit migrate`** history. In those cases:

- There may be **no** `drizzle.__drizzle_migrations` journal table.
- Running **`npm run db:migrate`** from scratch can **fail** (e.g. enum/type already exists) because the DB is not an empty slate.

That does **not** mean you should skip schema alignment. It means you need a **defensive, additive** workflow.

## Safest ongoing approach

1. **Treat `shared/schema.ts` as the source of truth** for what the application expects.
2. When you add columns or tables, **generate SQL** with `npm run db:generate` and commit the new files under `migrations/`.
3. **Apply additive SQL** in each environment using one of:
   - **Neon / hosting SQL editor** — run the new `migrations/000X_*.sql` statements manually for that release, or
   - **`npm run db:ensure`** (for anything mirrored under `server/sql/ensure/`), or
   - **`psql`** / admin client with the same `DATABASE_URL` as production.

4. **Avoid** `drizzle-kit migrate` on "messy" legacy DBs unless you have reconciled the journal (baseline) with help from someone who knows the full history.

## Induction queue columns (`x_handle`, `induction_status`)

If `/api/vote/induction` returns 500 with `column "x_handle" does not exist`, the app code is ahead of the database.

**Fix (idempotent, safe to re-run):**

```bash
npm run db:ensure-induction-cols
# or
npm run db:ensure
```

**Then** import or run the app as usual:

```bash
npm run import:induction
```

## Pre-push / pre-deploy checklist (target environment)

Before merging to **main** or deploying:

1. **Schema:** Run **`npm run db:ensure`** (or at minimum **`npm run db:ensure-induction-cols`**) against the **target** `DATABASE_URL`.
2. **Data:** If this release includes induction CSV changes, run **`npm run import:induction`** against that same database.
3. **Smoke:** `GET /api/vote/induction` should return **200** and a populated `data` array (not 500).
4. **App:** Restart the API after DB work so pools recover from transient Neon issues.

Optional validation after an import:

```bash
npx tsx --env-file=.env server/scripts/validate-induction-post-import.ts
```

## Recommended deploy order

1. Run **`npm run db:ensure`** against production `DATABASE_URL`.
2. Deploy application code.
3. Run one-off data jobs (e.g. **`npm run import:induction`**) if needed.
4. Restart the API.

## When `db:push` is still useful

`npm run db:push` (see `scripts/db-push-safe.cjs`) can help **development** environments stay close to `shared/schema.ts`, but production should prefer **explicit, reviewable SQL** or **idempotent ensure** files under `server/sql/ensure/` so you never depend on interactive prompts or accidental destructive defaults.

## Cold-start "New" badge for newly inducted leaderboard entrants

When a candidate is approved via the admin portal, code inserts a `trending_people` row with **`rank = 0`**, **`fame_index = 0`**, **`trend_score = 0`**.

- The leaderboard API returns **`leaderboardRank: null`** for anyone with `fame_index = 0` (cold-start).
- The frontend `LeaderboardRow` displays a **"New"** badge instead of a numeric rank when `rank` is null or 0.
- The live-tick job skips rank clamping for `rank = 0` people (keeps the sentinel intact).
- After the **first successful ingestion cycle**, `fame_index` and `rank` are set to real computed values (`1..N`), the "New" badge disappears, and the real dynamic rank shows automatically.
- `fame_index = 0` is never a legitimate post-ingest value (ingest's 50k avg safeguard ensures real values are in the 100k-600k range).

**One-time repair for existing rows** (e.g. rows still showing `rank = 999` from before this change):

```sql
UPDATE trending_people SET rank = 0 WHERE fame_index = 0 OR rank >= 999;
```

Alternatively, a **successful full data ingestion** will recompute all ranks as `1..N` by fame and replace any placeholder automatically.

**Expected cold-start behavior (not bugs):**

- **24h / 7d deltas** stay null ("—") until at least two ingest snapshots with `snapshot_origin = 'ingest'` exist.
- **Approval rating** stays "—" until users vote.
- **GDELT news gating** sorts by `trending_people.rank`; `rank = 0` people sort before rank 1 numerically, which is harmless since GDELT picks candidates by top-N rank and wiki pageviews. After first ingest they get a real rank.

## Local UI sanity (Induction Queue)

After a successful import and **`GET /api/vote/induction` → 200**:

- Open **Vote → Induction Queue** with category **All**; you should see cards (not perpetual spinner, not "No candidates match your filter criteria" unless a filter is set).
- **Images** load from Supabase `celebrity-large/{image_slug}/1.webp` (with URL-encoded slug segments for accents).
- **Voting:** `POST /api/vote/induction/:id/vote` requires an authenticated session — verify while **signed in** in the browser.
