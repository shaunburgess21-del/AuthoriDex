# AuthoriDex — Background Jobs & Schedulers

## Overview

AuthoriDex runs 4 background schedulers on Railway. These are bootstrapped in `server/index.ts` at startup. They do NOT run during frontend-only builds.

---

## Scheduler Summary

| Job | Frequency | Purpose |
|---|---|---|
| Ingestion Scheduler | Every hour at :02 | Full data fetch + score calculation |
| LiveTick | Every 10 minutes | Fast rank recalculation (no external API calls) |
| Seed Engine | Hourly at :30 (Mon-Tue only) | Discovers and seeds new people candidates |
| Market Resolver | Every 5 minutes | Resolves completed prediction markets |
| Staleness Monitor | Every 30 minutes | Alerts if data is stale |

---

## 1. Ingestion Scheduler

**Runs:** Every hour at :02 past the hour (e.g. 14:02, 15:02)
**Location:** `server/jobs/` + `server/ingestion/`

### What it does:
1. Acquires a distributed lock (prevents double-runs)
2. Fetches data for all 100 tracked people from external sources
3. Calculates composite influence scores
4. Writes snapshots to `trend_snapshots` table
5. Releases lock and logs completion

### External APIs used:
- **Serper** — Google search results / news mentions
- **Mediastack** — News article volume and sentiment
- **Wiki** — Wikipedia pageview counts
- **GDELT** — Global news event database

### Source health states:
- `HEALTHY` — API responding normally
- `DEGRADED` — Some failures, using cached data
- `OUTAGE` — API down, fully using cache

### Lock system:
- Uses `ingest_locks` table in Supabase
- Prevents Railway + local from double-ingesting
- Stale locks (>15 min) are automatically cleared

### Deduplication:
- Each hour has a unique `hourBucket` timestamp
- If a run already completed for that hour, it skips (`SKIP_ALREADY_INGESTED`)
- Safe to restart — won't double-process

---

## 2. LiveTick

**Runs:** Every 10 minutes
**Location:** `server/jobs/liveTick.ts` (or similar)

### What it does:
1. Reads latest snapshot scores from Supabase
2. Recalculates rankings based on recent vote activity
3. Writes updated rank positions
4. Does NOT call any external APIs

### Purpose:
Keeps the leaderboard feeling "live" between full hourly ingestions. Captures vote momentum in near real-time.

### Logs to watch:
```
[LiveTick] Processed 100 people, 80 rows written, 0 rank changes
[LiveTick] Next tick at 2026-03-01T14:20:00.000Z (in 598s)
```

---

## 3. Seed Engine

**Runs:** Hourly at :30 past the hour, Monday and Tuesday only
**Location:** `server/jobs/seedEngine.ts` (or similar)

### What it does:
- Discovers new candidate public figures to potentially add to the index
- Evaluates candidates against relevance thresholds
- Seeds approved candidates into the tracking pool

### Why Mon-Tue only:
Limits API usage — seeding is expensive and only needs to run a couple of times per week.

---

## 4. Market Resolver

**Runs:** Every 5 minutes (with 2-minute startup delay)
**Location:** `server/jobs/marketResolver.ts` (or similar)

### What it does:
- Checks all open prediction markets
- Resolves markets where the outcome deadline has passed
- Awards XP to users who predicted correctly
- Updates user credibility scores

---

## 5. Staleness Monitor

**Runs:** Every 30 minutes
**Location:** Bootstrapped in `server/index.ts`

### What it does:
- Checks timestamp of latest `trend_snapshot`
- If latest snapshot is >2.5 hours old, logs a staleness alert
- Does not auto-fix — alerts only

### Log to watch:
```
[STALENESS ALERT] Latest snapshot is 2h 29m old — ingestion may be delayed
```

---

## Local Development Notes

When running locally with `npm run dev`:

- All schedulers START (they boot with the server)
- Ingestion scheduler will ATTEMPT to run but will fail gracefully without API keys (Serper, Mediastack)
- Wiki fetches may succeed (uses cache)
- GDELT fetches may partially succeed (uses cache)
- LiveTick will run but write 0 rows if no recent vote activity
- **No API quota is consumed** without Serper/Mediastack keys in `.env`

### To fully disable schedulers locally:
Add to `.env`:
```
DISABLE_SCHEDULERS=true
```
Note: This flag needs to be wired into `server/index.ts` bootstrap logic to take effect.

---

## Monitoring

Check scheduler health via:
```
GET /api/system/freshness
```

Response includes:
- `systemStatus` — healthy / degraded / outage
- `fullRefreshAt` — last ingestion timestamp
- `liveUpdatedAt` — last LiveTick timestamp
- Source health per provider (serper, mediastack, wiki, gdelt)

---

## Manual Trigger (if needed)

If ingestion needs to be manually triggered on Railway:
- Go to Railway → your backend service → terminal
- The ingestion job runs automatically but can be inspected via logs

---

## Backfill System

If ingestion missed an hour (e.g. Railway restart), the backfill system:
1. Detects gaps in the last 12 hours
2. Fills them sequentially
3. Skips hours already completed

Log to watch:
```
[Backfill] Found 1 gap(s) in last 12h — filling sequentially
[Backfill] SKIP_ALREADY_INGESTED: Hour already has completed run
```
