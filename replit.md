# AuthoriDex - Real-Time Authority Tracking Platform

## Overview
AuthoriDex is a real-time platform for tracking trending celebrities and influencers globally. It aggregates data from various sources to provide live trend rankings, unified trend scores, and percentage changes. The platform aims to be a leading tool for analyzing global fame, offering search, filter, sort, and detailed analytics capabilities, inspired by financial tracking and social trending interfaces. Key features include prediction markets and gamified user interactions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS.
- **UI/UX**: Radix UI and shadcn/ui (New York style) with custom dark/light themes, HSL color tokens, and a glassy neon aesthetic. Features a mobile-first responsive design.
- **Key Features**: Global Favorites Filter, Custom Topic Support, "+ Suggest" buttons, Bloomberg-style Compare Momentum Graph, and interactive elements.
- **Page Structure**: Core pages include Home, Vote, Predict, Me, Public Profiles, Prediction Leaderboard (`/predictions/leaderboard`), and an Admin Panel for site management.
- **Sentiment Polls Data**: 227 polls seeded across 7 categories (Tech 41, Politics 40, Business 35, Sports 35, Custom Topic/misc 33, Creator 31, Music 12) via CSV import. Re-import available via Admin Dashboard → Voting CMS → Sentiment Polls → "Import CSV" button or `npx tsx scripts/import-sentiment-polls.ts`.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints.
- **Scoring Engine**:
    - Calculates a Fame Score (0-1,000,000) based on Mass (40%) and Velocity (60%). Velocity sources are Wikipedia (25%), News (35%), and Search (40%).
    - Utilizes per-source normalization, percentile ranking, and multi-layered stabilization to prevent fluctuations.
    - Includes robust features like circuit breakers, stale cache fallbacks, adaptive request spacing, and proactive cache reuse for external API calls.
    - Employs an Auto Catch-Up Mode for data ingestion and graceful degradation for external API failures.
    - Ensures data integrity with strict writing protocols and DB-level guardrails.
    - Generates AI-powered "Why Trending" summaries using `gpt-4o-mini` with sophisticated caching and rate limiting.
    - Tracks ingestion runs with detailed health summaries and uses a DB-backed lock to prevent concurrent runs.
    - Provides an Engine Health Dashboard for comprehensive diagnostics.
    - Tapers velocity contribution when news/search signals are low and adjusts weights based on source health and staleness.
    - Implements deterministic baseline selection for trend changes and score versioning to ensure consistency after formula changes.
    - Features Leaderboard Resilience with snapshot-based fallbacks and boot-time hydration to prevent empty leaderboards.
    - **Mediastack Integration (Primary News Provider)**: Mediastack API is the primary news source with a persisted 2-hour refresh cadence (`system:mediastack:last_fetch_at` in api_cache). Coverage uses split metrics: `successCoveragePct` (API responded with pagination.total, even if 0) for fallback-to-GDELT gate, `nonZeroCoveragePct` (articles > 0) for quality monitoring, and `top25NonZeroCoveragePct` (top-25 by rank with articles > 0) for cohort quality. Cache-only mode on non-refresh ticks. Budget tracking with daily call counts and 7-day retention.
    - **Persisted Instrumentation**: Three system keys in `api_cache` for observability: `system:lastRunMeta` (full last-run diagnostics including provider, coverage, fallback stats), `system:healthSummary` (consolidated health summary per run), `system:source_health_state` (source health state machine). All survive process restarts and are surfaced in the engine health endpoint under `persistedInstrumentation`.
    - **Cascading News Provider Hierarchy**: Mediastack (primary) → GDELT (secondary) → Serper News (emergency). Each provider tagged in snapshot diagnostics via `newsSource`. Serper News fallback only triggers from GDELT (not Mediastack). Fallback override allows health state recovery.
    - Implements Per-Person News Fallback: When primary news source (Mediastack or GDELT) fails for specific individuals, targeted Serper calls patch affected people. For Mediastack: 3+ consecutive refresh-cycle snapshots with news_count < 2 (ignores cache-reuse ticks). For GDELT: 2+ consecutive bad runs. Qualification gate: top-25 by rank OR wiki/search above p50. Safety rails: max 15 per run, 90-min cooldown per person, priority by rank. Fallback data bypasses fill-forward decay path. Stats tracked in health summary, engine health endpoint, and per-snapshot diagnostics.
    - Employs a Degradation Governor to gradually reduce source weights during prolonged coverage drops and includes recovery hysteresis.
    - **EMA Hold Rule**: When a provider is globally healthy but an individual person shows an 80%+ drop from baseline, holds the prior EMA value instead of updating with the artifact. Prevents leaderboard whiplash from provider blind spots. Flags `newsEmaHeld`/`searchEmaHeld` in snapshot diagnostics.
    - **Canary People List**: 10 well-known people across categories (Trump, Musk, LeBron, Bad Bunny, Ronaldo, Modi, Zuckerberg, Kendrick, Putin, AOC) act as early-warning canaries. If 4+ canaries fail simultaneously, accelerates source health state transition to DEGRADED. Uses hysteresis to prevent flapping: requires 2 consecutive canary trips to accelerate to DEGRADED, and 3 consecutive healthy checks to clear the trip streak. Streak counters (`canaryTripStreak`, `canaryRecoverStreak`) are persisted in source health state. Results surfaced in health summary.
    - **Raw Evidence Storage**: Each snapshot stores top 3 news article headlines and provider name in diagnostics `evidence` section for debugging score changes.
    - Implements a Two-Speed Leaderboard Pipeline for hourly full refreshes and fast-lane 10-minute ticks based on internal signals.
    - **Automatic Gap Backfill**: After each successful hourly ingest, detects missing hour slots in the last 12 hours and fills up to 3 oldest gaps. Backfilled snapshots use `snapshotOrigin: 'backfill'` — included in EMA/delta baseline calculations but excluded from chart history endpoints (which filter for `'ingest'` only). A deadline guard stops backfilling if the next primary run is < 15 minutes away to prevent lock contention. Idempotency check: skips hours that already have snapshots OR a completed `ingestionRuns` record.
    - **Staleness Monitor**: Runs every 30 minutes (5-min startup delay). Logs `[STALENESS ALERT]` at >2h and `[STALENESS CRITICAL]` at >4h since latest snapshot. Optional Discord webhook via `DISCORD_WEBHOOK_URL` env var. Exposes `staleness: { ageMinutes, isStale, isCritical, latestSnapshotAt }` on the `/api/admin/engine-health` endpoint.

### Serverless Architecture
- **Design**: Stateless, using Supabase Database for all state management.
- **Cron Endpoints**: Authenticated API endpoints for scheduled tasks.

### Image Storage Architecture
- **Supabase Storage Buckets** (optimized WebP, replacing legacy 1.3MB PNGs):
  - `celebrity-small` → `_compressed_small_100kb_webp/{slug}/{index}.webp` (~42KB, for tile/list views)
  - `celebrity-large` → `_compressed_large_200kb_webp/{slug}/{index}.webp` (~101KB, for detail/expanded views)
  - `leaders-small` → `_compressed_70kb/{slug}/{index}.webp` (~67KB, for induction candidates)
  - `leaders-large` → `_compressed_150kb_expanded/{slug}/{index}.webp` (for expanded candidate views)
  - Legacy: `celebrity_images/{slug}/{index}.png` (fallback)
- **Image Resolver** (`client/src/lib/imageResolver.ts`): Context-specific cascading URL fallback system. Three contexts: `"tile"` (celebrity-small → leaders-small → legacy), `"expanded"` (celebrity-large → leaders-large → celebrity-small → legacy), `"induction"` (leaders-small only, 1.webp → 2.webp). Uses `useResolvedImage` React hook with `key`-based Radix Avatar re-mounting for reliable fallback cascading.
- **`image_slug`** field on both `tracked_people` (100 backfilled) and `induction_candidates` (116 pre-populated) for bucket path resolution.

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schemas**: `users`, `tracked_people` (with `image_slug`), `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`.
- **Gamification Schemas**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates` (lean: `display_name`, `category`, `image_slug`, `seed_votes`, `wiki_slug`, `is_active`), `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schemas**: `prediction_markets`, `market_entries`, `market_bets`, `open_market_comments`.
- **Payout Pipeline Hardening**: `settleMarketBets()` and `voidMarketBets()` write immutable `credit_ledger` entries (txnTypes: `prediction_payout`, `prediction_refund`) with idempotency keys (`payout_{marketId}_{betId}`, `refund_{marketId}_{betId}`). Market-level idempotency guard: returns early if market status is already RESOLVED/VOID. Bet placement (`POST /api/open-markets/:slug/bet`) writes `prediction_stake` ledger entries in a transaction. Pool conservation tracked via `remainder` field. `credit_ledger.userId` FK to `users` removed (supports both legacy users and Supabase profiles). E2E test endpoint gated by `ENABLE_TEST_ENDPOINTS=true` env var. Test script: `npx tsx scripts/test-payout-e2e.ts`.
- **Remainder Policy**: Burned (virtual credits). Rounding remainder from `Math.round()` pari-mutuel distribution is not redistributed. Settlement result includes `remainderPolicy: 'burned'` for API visibility. Appropriate for virtual credits; revisit if real-money markets are added.
- **Admin Payout Tools**: `GET /api/admin/credit-reconciliation` compares `profiles.predictCredits` against `SUM(credit_ledger.amount)` per user, flags discrepancies. `GET /api/admin/markets/:id/payout-summary` returns pool/payouts/remainder/ledger breakdown for any market.
- **Credit Ledger Indexes**: `credit_ledger_user_history_idx` on `(user_id, created_at)` for efficient credit history queries. Unique composite `(user_id, idempotency_key)` for dedup.
- **Community Schemas**: `community_insights`, `insight_votes`, `insight_comments`, `platform_insights`, `insight_items`, `user_votes`, `user_favourites`.
- **Value Voting**: `celebrity_value_votes`, `celebrity_metrics` for approval/value aggregation.
- **AI-Generated Celebrity Profiles**: Cached biographical data.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **Mediastack API**: Primary news article counts (Professional plan, 50k calls/month). Budget guardrails: warning at 85% projected monthly usage, hard stop at 95%. Budget metrics surfaced in engine health endpoint.
- **GDELT API**: Secondary news mention counts (fallback).
- **Serper.dev API**: Google search results + emergency news fallback.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.
- **OpenAI**: `gpt-4o-mini` for AI-generated summaries.

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.