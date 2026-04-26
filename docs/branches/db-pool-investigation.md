# DB Pool Investigation

Date: 2026-04-26

Scope: read-only investigation after smoke testing saw unrelated 500s with `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`.

## Current State

### Connection String Mode

- Runtime database URL is read from `process.env.DATABASE_URL`.
- `ENV.md` documents the expected URL as Supabase Session Pooler on port `5432`:
  - `postgresql://postgres.[ref]:[password]@aws-1-eu-north-1.pooler.supabase.com:5432/postgres`
  - It explicitly says to use `Supabase -> Settings -> Database -> Session Pooler`.
- The observed error text says `max clients reached in session mode`, which confirms the failing connection path is Supabase PgBouncer Session Pooler.
- I did not print or inspect secret `.env` values. The local `.env` file is gitignored/not visible through normal repository search and should be checked by Shaun.
- No Railway env file is present in the repository. Railway `DATABASE_URL`, `DB_POOL_MAX`, and `DISABLE_SCHEDULERS` need dashboard verification.

### Application Pool Configuration

Database pool is configured in `server/db.ts`:

- Driver: `pg.Pool`
- ORM: `drizzle-orm/node-postgres`
- Connection string: `process.env.DATABASE_URL`
- Pool max: `DB_POOL_MAX`, defaulting to `10`
- Idle timeout: `30000ms`
- Connection timeout: `10000ms`
- SSL: defaults to `{ rejectUnauthorized: false }` unless `DATABASE_SSL_REJECT_UNAUTHORIZED=true` or `DATABASE_CA_CERT` is set

The local log line:

```text
[DB Pool] total=10 idle=10 waiting=0 max=10
```

matches the default local `DB_POOL_MAX=10`. With Session Pooler, those 10 idle app-side connections still occupy 10 server-side session-pooler client slots.

### Background Jobs Sharing The Same Pool

`server/index.ts` starts the DB pool monitor and, unless schedulers are disabled, also starts several background schedulers inside the same API process:

- Ingestion
- LiveTick
- Seed Engine
- MarketResolver
- Staleness Monitor
- MarketGenerator
- AgentRunner
- ActionWorker
- VoteWorker
- ApprovalSnapshots

`JOBS.md` says local `npm run dev` starts all schedulers unless `DISABLE_SCHEDULERS=true`. It also documents that schedulers can be disabled locally via `.env`.

### Slow Queries Observed

Observed during smoke:

- `GET /api/opinion-polls`: `6209ms`, `6395ms`, `6413ms`, `6209ms`
- `GET /api/leaderboard`: `6245ms`, `4397ms`, `6092ms`

### Slow Handler Inventory

`GET /api/opinion-polls` in `server/routes.ts`:

- Loads all live polls ordered by `createdAt`.
- Calls `getRelatedPeopleForCards("opinion_poll", opPollIds)` once, which is batched.
- Then uses `Promise.all(polls.map(...))`.
- Per poll, it runs up to three DB queries:
  - options joined to `tracked_people`
  - vote counts grouped by option
  - current user's vote, if authenticated
- This is an N+1 pattern over polls. Because it is inside `Promise.all`, it can issue many queries concurrently and consume many pool connections at once.
- Relevant indexes exist in `shared/schema.ts`:
  - `opinion_polls.visibility`
  - `opinion_poll_options.poll_id`
  - `opinion_poll_options (poll_id, order_index)`
  - `opinion_poll_votes.poll_id`
  - `opinion_poll_votes.option_id`
  - unique `(user_id, poll_id)`
- Likely performance issue is query fan-out/concurrency more than an obvious missing index, though query plans should be checked before any query rewrite.

`GET /api/leaderboard` in `server/routes.ts`:

- Runs a count query.
- Runs the main `trending_people` query with joins to `tracked_people` and `celebrity_metrics`.
- Calls `getSnapshotRankMap()`, which can query previous snapshot ranking data unless cached.
- Computes leaderboard thresholds. If cache misses, it queries all `trending_people` rows and computes threshold arrays in JS.
- For `tab=approval`, it additionally queries all matching rows to build `approvalRankById`.
- Calls `getBaselineDiagnostics(totalCount)` before responding.
- Likely performance contributors:
  - several sequential DB round trips
  - global rank/threshold work outside the paginated result set
  - baseline diagnostics in the request path
  - possible cache misses after process restart or new ingestion runs
- Existing indexes on `trending_people` include `rank` and `category`. No schema-level index was found for `fame_index_live`, `fame_index`, or celebrity metric sort columns in the inspected schema.

`GET /api/people/:id/images` in `server/routes.ts`:

- Simple query against `celebrity_images` by `person_id`, ordered by `votes_up` and `added_at`.
- If authenticated, runs a second query for current user's image votes.
- This endpoint looks like a victim of pool exhaustion, not a root cause.

`GET /api/matchups` in `server/routes.ts`:

- Loads all matchups.
- Loads all tracked people for avatar lookup.
- Batches face-off vote counts.
- Batches related people.
- Does not show an obvious N+1 pattern in the current handler.
- This endpoint also looks more like a victim of pool exhaustion than the primary source.

`POST /api/profile/sync` in `server/routes.ts`:

- Calls Supabase Admin API first.
- Then queries `profiles`, runs a small transaction for update/create plus credit ledger, and queries the updated profile.
- No obvious leak was found in the handler. The 500 stack trace failing on the initial profile query is consistent with pool exhaustion.

## Root Cause Hypothesis

Primary hypothesis:

The project is using Supabase Session Pooler with an app-side `pg.Pool` defaulting to 10 connections. Session pooling keeps app connections attached to PgBouncer sessions even while idle. The Supabase session pool limit observed in the error is 15. A single local dev server can hold 10 idle session slots. If Railway production, another local server, background schedulers, or another collaborator's dev server also connects to the same shared Supabase project, the aggregate session count can exceed 15 and cause unrelated endpoints to fail with `EMAXCONNSESSION`.

Contributing factors:

- Local and production appear to share the same Supabase database project.
- In-process schedulers run by default locally and in production unless disabled.
- Some public endpoints, especially `GET /api/opinion-polls`, fan out multiple concurrent DB queries.
- Some public endpoints, especially `GET /api/leaderboard`, do several sequential/global DB operations on the request path.
- Slow queries hold pool clients longer, increasing the chance of hitting the session-pooler limit during concurrent page loads.

Why this is not specific to the voted-labels branch:

- The failing endpoints were unrelated to the voted-labels changes.
- Stack traces failed on ordinary DB reads across unrelated routes.
- The error came from the database pooler/session limit, not a code exception in the voted-label logic.

## Connection Leak Audit Findings

### Raw Pool Usage

Runtime raw `pool` usage found:

- `server/db.ts`
  - Creates the singleton `pg.Pool`.
  - `withDbAdvisoryLock()` calls `pool.connect()` and releases in `finally`; this looks safe.
  - `startDbPoolMonitor()` only reads pool counters.
- `server/index.ts`
  - Registers `pool.on("error")`.
  - Uses `pool.query(...)` for startup guardrails and staleness checks; `pool.query` does not require manual release.

Script-only raw pool usage found:

- Several scripts import `pool` and call `pool.end()` in `finally`.
- `server/scripts/run-ensure-schema.ts` uses `pool.connect()` and releases in `finally`, then ends the pool.
- These are not request-path leaks unless scripts are run concurrently with the app against the same database.

### Transactions

- Runtime transactions inspected use Drizzle's `db.transaction(async (tx) => ...)`.
- No manual `BEGIN` without matching `COMMIT` or `ROLLBACK` was found in the searched server code.

### Long-Lived Session Features

Search did not find app-level use of:

- `LISTEN`
- `NOTIFY`
- `SET TIMEZONE`
- session-scoped `SET ...` usage
- manually named prepared statements

The main caveat is ORM/driver behavior: Drizzle with `node-postgres` should be tested against Supabase Transaction Pooler before switching production, because transaction pooling is not compatible with session-scoped prepared statements.

### Leak Risk Summary

No high-confidence connection leak was found. The evidence points to pool exhaustion from Session Pooler slot pressure plus slow/concurrent request patterns, rather than unreleased clients.

## Recommended Changes

Implementation should happen on a separate branch, suggested name: `chore/db-pool-tuning`.

### 1. Separate Dev And Production Databases

Recommendation:

- Give local development and production separate Supabase projects/databases.

Why:

- Local smoke tests, Andrew's work, Shaun's work, and Railway production currently appear able to compete for the same session-pooler limit.
- This is the cleanest isolation and reduces both reliability risk and migration/data safety risk.

Risk/prerequisites:

- Requires Supabase project/database setup and env var coordination.
- Requires migration/seed strategy for the new dev database.

### 2. Reduce Local Pool Size

Recommendation:

- Set local `DB_POOL_MAX` lower than 10, likely 3-5, especially while using Session Pooler and a shared Supabase project.
- Keep `DISABLE_SCHEDULERS=true` locally unless actively testing schedulers.

Why:

- A local pool of 10 consumes most of the observed session-pooler limit of 15 even when idle.
- Smaller local pools leave headroom for Railway and other collaborators.

Risk/prerequisites:

- Some local pages may queue briefly under heavy smoke testing.
- Needs `.env` verification by Shaun.

### 3. Verify Railway Pool Size And Scheduler Mode

Recommendation:

- Check Railway variables:
  - `DATABASE_URL`
  - `DB_POOL_MAX`
  - `DISABLE_SCHEDULERS`
  - `CRON_SECRET`

Likely desired production posture:

- If Railway is the only API process and using Session Pooler, keep `DB_POOL_MAX` conservatively below the Supabase session pool limit, for example 5-8, unless the Supabase pool size is increased.
- If external cron is configured, set `DISABLE_SCHEDULERS=true` on the API service so cron endpoints drive background work without duplicate in-process schedulers.

Risk/prerequisites:

- Need Railway dashboard access.
- Need to know whether Railway runs one process or multiple replicas.
- Need Supabase dashboard pool-size value.

### 4. Consider Supabase Transaction Pooler

Recommendation:

- Evaluate switching app runtime `DATABASE_URL` from Session Pooler to Transaction Pooler, typically port `6543`.

Why:

- Transaction pooling is better for many short-lived web requests.
- It reduces the cost of idle app connections consuming long-lived session slots.

Prerequisites:

- Confirm Drizzle + `pg` runtime queries work with transaction pooling.
- Confirm no app code relies on session state. Current code search found no `LISTEN/NOTIFY`, no session-scoped `SET`, and no manual prepared statements.
- Smoke test migrations and app startup separately; migration scripts may be safer on direct/session connection depending on transaction-pooler DDL behavior.

Risks:

- PgBouncer transaction mode can break session-level prepared statements or session state if the driver/ORM uses them.
- Long transactions still occupy a server connection until completion.
- Some migration/admin scripts may need to keep using a non-transaction-pooler URL.

### 5. Inventory Query Optimization Separately

Recommendation:

- Do not fix slow queries in the pool-tuning branch unless necessary.
- Open a separate performance branch for:
  - batching `GET /api/opinion-polls`
  - reviewing `GET /api/leaderboard` request-path global work
  - adding query timing instrumentation and database `EXPLAIN ANALYZE`

Why:

- Pool tuning and query optimization are related but different risk profiles.
- The current issue can likely be reduced significantly by pool mode/size changes first.

## Risks And Prerequisites

- Session Pooler with `DB_POOL_MAX=10` is fragile when the Supabase pool limit is 15 and more than one process uses the same project.
- Reducing pool size can increase local request latency under concurrent smoke testing but should reduce 500s.
- Switching to Transaction Pooler needs compatibility validation with Drizzle/node-postgres and deployment/migration scripts.
- Disabling schedulers locally is safe for ordinary UI work, but not for testing ingestion/live tick behavior.
- Increasing Supabase pool size may help, but without query and scheduler discipline it can mask underlying load and cost issues.

## Open Questions For Shaun

1. What is the exact local `.env` `DATABASE_URL` host and port, redacted for password? Is it Session Pooler `5432`, Transaction Pooler `6543`, or direct?
2. What is local `DB_POOL_MAX` set to, if any? The log suggests effective max is 10.
3. Is local `.env` setting `DISABLE_SCHEDULERS=true` during normal UI smoke tests?
4. What is Railway `DATABASE_URL` host and port?
5. What is Railway `DB_POOL_MAX`, if set?
6. Does Railway run one backend replica or multiple?
7. Is Railway using in-process schedulers, external cron, or both? Check `DISABLE_SCHEDULERS` and `CRON_SECRET`.
8. What is the Supabase Session Pooler configured pool size in the dashboard? The error says 15 for the observed path.
9. Is Transaction Pooler enabled in Supabase for this project, and what is its exact URL/port?
10. Do Andrew and Shaun currently share the same Supabase project for local development and production?

## Proposed Implementation Sequence

Implementation should be a separate branch: `chore/db-pool-tuning`.

1. Confirm environment values with Shaun:
   - local DB URL mode
   - Railway DB URL mode
   - local/Railway `DB_POOL_MAX`
   - Supabase pool limits
   - scheduler mode
2. Make a configuration-only local recommendation:
   - local `DB_POOL_MAX=3` to `5`
   - local `DISABLE_SCHEDULERS=true` for UI smoke
3. Decide production pool strategy:
   - either conservative Session Pooler sizing below the Supabase pool limit
   - or staged Transaction Pooler switch for runtime traffic
4. If testing Transaction Pooler:
   - use a non-production/staging env first
   - run `npm run check`
   - boot app
   - smoke auth/profile sync, leaderboard, opinion polls, comments, votes, native markets, and admin basics
   - verify migrations/deploy scripts use an appropriate database URL
5. Add lightweight query timing instrumentation in a later performance branch if slow `opinion-polls` and `leaderboard` remain.
6. Open a separate query optimization branch only after pool mode/size is stable.

