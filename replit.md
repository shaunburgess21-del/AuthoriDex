# AuthoriDex - Real-Time Authority Tracking Platform

## Overview
AuthoriDex is a real-time platform designed to track trending celebrities and influencers globally. It aggregates data from various sources to provide live trend rankings, unified trend scores, and percentage changes. The platform aims to be a leading tool for analyzing global fame, offering search, filter, sort, and detailed analytics capabilities, inspired by financial tracking and social trending interfaces. It includes features like prediction markets and gamified user interactions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS.
- **UI/UX**: Radix UI and shadcn/ui (New York style) with custom dark/light themes, HSL color tokens, and a glassy neon aesthetic. It features a mobile-first responsive design.
- **Key Features**: Global Favorites Filter, Custom Topic Support, "+ Suggest" buttons, Bloomberg-style Compare Momentum Graph, and interactive elements like expandable leaderboard rows and a VotingModal.
- **Page Structure**:
    - **Core Pages**: Home (hero, trend widgets, leaderboard), Vote (community town hall, face-offs, polls), Predict (parimutuel markets), Me (user dashboard), Public Profiles.
    - **Admin Panel**: Protected routes for comprehensive site management (celebrities, users, moderation, system tools).

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints.
- **Scoring Engine**:
    - **Fame Score**: A primary UI score (0-1,000,000) derived from a normalized trend score.
    - **Fixed Weights**: Mass (40%) and Velocity (60%), with velocity sources from Wikipedia (25%), News (35%), Search (40%).
    - **Normalization & Stabilization**: Per-source normalization using `log1p` and percentile ranking against a **rolling 14-day reference distribution** (p25/p50/p75/p90 computed from actual `trend_snapshots` data, persisted to `api_cache` as `system:source_stats_reference` for restart survival). Falls back to persisted stats, then hardcoded defaults as last resort. Multi-layered stabilization prevents fluctuations with dynamic rate limiting, spike detection, and dynamic EMA alpha. **Wiki Winsorization (Feb 2026)**: p99 cap (p90 + 2*(p90-p75)) applied to raw values and effective max in percentile ranking to prevent single outliers from dominating normalization. **Wiki Mass Cap**: Wiki-only mass capped at `wikiMassScore * 0.50` (consistent with follower-present weighting) to prevent wiki dominance when follower channels are inactive.
    - **GDELT Hardening (Feb 2026)**: Circuit breaker (3 failures → 5-min pause), sequential requests with 5.5s spacing + jitter (was parallel 800ms), stale cache fallback, candidate gating (top 25 by rank + top 25 by wiki = ~35-50 fresh API calls instead of ~100), 2-min time budget per batch.
    - **Auto Catch-Up Mode**: Three-band gap-driven rate boosting for data ingestion, with state persisted in the database.
    - **Robustness**: Graceful degradation handles external API failures, and a coverage gate ensures data consistency.
    - **Data Integrity**: Multi-layer protection against mock data corruption, strict writing protocols for `trending_people` via `ingest.ts`, and DB-level guardrails for `trend_snapshots`.
    - **Trend Context**: AI-generated "Why Trending" summaries (`gpt-4o-mini`) with sophisticated caching and rate limiting, providing 1-2 sentence summaries and categories. Non-AI trend context uses keyword matching for driver detection.
    - **Why Trending Hardening (Feb 2026)**: Top-10 hysteresis (enter ≤10, exit ≥12, rank-11 grace), input hash caching (domain+title SHA-256, skip OpenAI if headlines unchanged), single-flight lock (60s TTL prevents cache stampede), per-person rate limit (30 min), provenance fields (model, promptVersion, headlinesUsed), debug fields (cacheStatus: HIT|STALE_EXTENDED|REGENERATED|RATE_LIMITED|LOCKED_STALE|LOCKED_COLD|NO_NEWS, staleAgeMinutes).
    - **Ingestion Run Tracking (Feb 2026)**: `ingestion_runs` table records every ingestion execution with started_at, finished_at, status (running/completed/failed/locked_out), snapshots_written, people_processed, per-source timings (wiki/gdelt/serper in ms), source statuses (OK/DEGRADED/FAILED), heartbeat_at, and full health_summary JSONB. DB-backed ingestion lock prevents concurrent runs via unique partial index (`WHERE status='running'`) for race safety. Heartbeat mechanism updates `heartbeat_at` every 2 minutes; stale detection uses 10-minute heartbeat timeout instead of fixed start time. Lock-out events recorded for debugging overlaps.
    - **Engine Health Dashboard**: Admin endpoint `GET /api/admin/engine-health` provides comprehensive diagnostics including 3 top-level badges (Freshness, Continuity, Integrity), ingestion run history (last 10 runs with source indicators), per-source health (timing + status from last successful run), gap detection, backfill detection, fame distribution, signal quality, rank integrity verification, and random spot checks.
    - **Velocity Taper**: Tapers velocity contribution when news/search signals are low to maintain stable mass while reflecting fading momentum.
    - **Scoring Engine Hardening (Feb 2026)**: DB-persisted source health state (survives restarts via `api_cache` key `system:source_health_state`). Staleness-aware velocity WEIGHT decay (stale source weight reduced + renormalized to remaining sources, capped at 1.5x base weight per source). Split wiki windowing (mass=7d avg, velocity=0.6*24h+0.4*7d blend for faster spike decay). Asymmetric rate limiting (down cap = 1.5x up cap) and asymmetric EMA alpha (down alpha = 1.5x base). Score audit endpoint `GET /api/admin/score-audit/:personId` for full component breakdown.
    - **Snapshot Diagnostics**: `diagnostics` JSONB column in `trend_snapshots` stores versioned debug data per snapshot. `run_id` VARCHAR column links each snapshot to its `ingestion_runs` row for deterministic baseline selection. Stabilization detail includes full pipeline: prevFame → rawFame → afterRateLimit → afterEma → finalFame, with capUsed, alphaUsed, asymmetric flag, and derived delta percentages (rawVsPrevPct, rateLimitDeltaPct, emaDeltaPct).
    - **Search & Wiki Improvements**: Composite Search Activity Score, Cache Validity Gate for Serper results, Search Query Override for disambiguation, and Wiki Velocity Smoothing using 7-day rolling averages.
    - **Deterministic Baseline Selection (Feb 2026)**: Hot Movers / rank change uses run-based baseline: finds the closest completed ingestion run to 24h ago and queries snapshots by `run_id`. Pinned until a new ingestion run completes or the hour changes. Falls back to hour-bucketed timestamps for older snapshots without `run_id`.
    - **Score Versioning (Feb 2026)**: `score_version` VARCHAR column on both `trend_snapshots` and `ingestion_runs` tables. `SCORE_VERSION` constant (currently `"v2"`) defined in `server/scoring/normalize.ts`. All baseline selection queries (24h, 7d, rank change) filter by matching `score_version`, preventing version mixing after formula changes. When no same-version baseline exists, `change_24h`/`change_7d` return `null` instead of misleading deltas. Version progression: v1 = pre-wiki-mass-cap, v2 = post-wiki-mass-cap. API response `meta` objects include `scoreVersion` for debugging.
    - **Leaderboard Resilience (Feb 2026)**: Snapshot-based fallback prevents empty leaderboard. When `trending_people` is empty (e.g., first boot, stale lock recovery), the `/api/leaderboard` endpoint reconstructs rankings from the latest completed ingestion run's `trend_snapshots` filtered by `run_id` + `score_version`. Response includes `meta.fallbackUsed`, `meta.fallbackRunId`, `meta.fallbackRunAt` for debuggability. Deltas are null in fallback mode. Stale-row cleanup in ingestion has a pre-delete safety check: counts rows to be deleted before executing, aborts transaction if remaining count would be below expected. Movers endpoints (`hot-movers`, `movers/:type`) also fall back to snapshot data when `trending_people` is empty. Freshness timestamps (`/api/system/freshness`) fall back to latest completed `ingestion_runs.finishedAt` when in-memory and `trending_people` timestamps are unavailable. **Boot-time hydration**: `hydrateTrendingPeopleFromSnapshots()` runs on server start and auto-populates `trending_people` from latest completed run's snapshots if table is empty, preventing empty-table scenarios after restarts.
    - **LiveTick Scheduler Fix (Feb 2026)**: Fixed tight-loop bug where `scheduleNext()` computed a tick time in the past (when `currentMinute` was already on a 10-min boundary), causing `setTimeout` with negative delay to fire immediately and flood logs. Now uses `Math.max(ms, 1000)` floor and properly handles boundary-exact timing (tick within 5s of boundary, else advance to next).
    - **Serper News Fallback (Feb 2026)**: Automatic news source switching when GDELT coverage drops below 30%. Uses `google.serper.dev/news` endpoint with `qdr:d` (24h) and `qdr:w` (7d) parameters. Activated per-ingestion-run based on GDELT freshness gate. Diagnostics track `newsSource: "gdelt" | "serper_news"` per person. Functions in `server/providers/serper.ts`. **Normalization parity**: Serper 7d article counts scaled by 2.5x to match GDELT's 250-record ceiling (Serper caps at 100), keeping delta calculations comparable across providers.
    - **Degradation Governor (Feb 2026)**: Run-over-run coverage tracking with gradual weight reduction. When a source's coverage drops >50 percentage points, weights ramp down over 3 runs (75% → 50% → 25% floor). **Recovery hysteresis**: requires 2 consecutive runs above 70% coverage before restoring full weight (prevents oscillation during flappy GDELT recovery). State persisted in source health (`prevCoveragePct`, `coverageDropRuns`, `consecutiveRecoveryRuns`). Applied via `Math.min(decayFactor, governorFactor)` in ingestion scoring inputs.
    - **API Meta Source Health (Feb 2026)**: Leaderboard API response `meta.sourceHealth` includes live state machine states (HEALTHY/DEGRADED/OUTAGE/RECOVERY) for news/search/wiki, plus `newsProviderUsed`, `newsFreshCoveragePct`, and `newsGovernorFactor` from the last completed run. Engine health admin endpoint includes `liveStateMachine` with decay factors, coverage percentages, drop run counts, recovery run counts, and `lastRun` block with full provider/coverage details. In-memory `LastRunMeta` exported from `server/jobs/ingest.ts` via `getLastRunMeta()`.
    - **Entity Resolution Diagnostics**: Admin tools to verify Serper search results match intended celebrities.
    - **Two-Speed Leaderboard Pipeline (Feb 2026)**: Hourly full refresh from external APIs (Wikipedia/GDELT/Serper) + fast-lane 10-minute ticks using internal signals (votes, profile views). Live tick applies 10-15% weight with ±3 rank cap and snap-back dampening (halves live weight when hourly disagrees by >5 ranks). DB columns: `fame_index_live`, `live_rank`, `live_updated_at`, `live_dampen`, `profile_views_10m`. Leaderboard sorts by `COALESCE(fame_index_live, fame_index)`. UI shows dual timestamps: "Live: Xm ago | Full: Ym ago" with info tooltips. Job file: `server/jobs/live-tick.ts`.

### Serverless Architecture
- **Design**: Stateless, using Supabase Database for all state management.
- **Cron Endpoints**: Authenticated API endpoints for scheduled tasks.

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schemas**: `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`.
- **Gamification Schemas**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schemas**: `prediction_markets`, `market_entries`, `market_bets`, `open_market_comments`.
- **Real-World Markets (Feb 2026)**: Polymarket-inspired prediction markets for any real-world topic. Uses `marketType='community'` + `openMarketType` (binary/multi/updown). Admin CMS for CRUD, settlement, voiding. API: `/api/open-markets` (list/create/get/update/settle/bet/comments). Frontend: 3 card variants (BinaryMarketCard, MultiMarketCard, UpDownMarketCard), dedicated `/markets/:slug` detail page. Seed data (seedParticipants/seedVolume) for social proof. Resolution rules with criteria and sources.
- **Community Schemas**: `community_insights`, `insight_votes`, `insight_comments`, `platform_insights`, `insight_items`, `user_votes`, `user_favourites`.
- **Value Voting**: `celebrity_value_votes`, `celebrity_metrics` for approval/value aggregation.
- **AI-Generated Celebrity Profiles**: Cached biographical data (bios, known for, origin, location, net worth) to minimize API calls.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **GDELT API**: News mention counts.
- **Serper.dev API**: Google search results.
- **X/Twitter API**: Reserved for future Platform Insights.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.
- **OpenAI**: `gpt-4o-mini` for AI-generated summaries.

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.