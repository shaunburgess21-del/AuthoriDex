# FameDex - Real-Time Fame Tracking Platform

## Overview
FameDex is a real-time platform designed to track trending celebrities and influencers globally. It aggregates data from various sources to provide live trend rankings, unified trend scores, and percentage changes. The platform aims to be a leading tool for analyzing global fame, offering search, filter, sort, and detailed analytics capabilities. It is inspired by financial tracking and social trending interfaces.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS.
- **UI/UX**: Radix UI and shadcn/ui (New York style) with a custom dark/light theme using HSL color tokens and a glassy neon aesthetic. It features a mobile-first responsive design.
- **Interactive Elements**: Expandable leaderboard rows, a VotingModal with "Vote Next" functionality, and square avatars with rounded corners.
- **Key Features**: Global Favorites Filter, Custom Topic Support, unified "+ Suggest" buttons, and a Bloomberg-style Compare Momentum Graph with time range toggles and high-contrast colors.
- **Page Structure**:
    - **Home Page**: Hero Section, Trend Widgets, Prediction Markets Teaser, filterable/sortable Leaderboard.
    - **Vote Page**: "Community Town Hall" theme with Face-Offs, Trending Polls, Induction Queue, and Curate Profile sections.
    - **Predict Page**: Parimutuel prediction markets with a "test mode" and various market types.
    - **Me Page**: User account dashboard with XP, credits, rank, votes, and predictions.
    - **Public Profiles**: User profiles displaying XP progress and voting statistics, with privacy controls.
    - **Admin Panel**: Protected routes for site management, including celebrity, game, moderation, settlement, user, and system tool management.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints with query parameters.
- **Scoring Engine**:
    - **Fame Score**: A primary UI score (0-1,000,000) derived from a normalized trend score.
    - **Fixed Weights**: Mass (40%) and Velocity (60%) with no dynamic redistribution.
    - **Active Velocity Sources**: Wikipedia (25%), News (35%), Search (40%). The X/Twitter API is not used for trend scoring due to cost constraints.
    - **Per-Source Normalization**: Each source is independently normalized using `log1p` compression and percentile ranking against 7-day population statistics.
    - **Score Stabilization**: A multi-layered approach prevents wild score fluctuations using dynamic rate limiting based on source corroboration (max 10% normal, 18% for 2 sources, 35% for 3 sources), robust spike detection, and dynamic EMA alpha.
    - **Graceful Degradation**: Handles external API failures by carrying forward last known values and detecting "suspicious drops."
    - **Fixed Velocity Weights** (Feb 2026 stability fix): Weights are ALWAYS fixed at Wiki 25%, News 35%, Search 40% - even during API outages. Weight redistribution during outages was causing population-wide rank instability.
    - **Recalibration Mode**: DISABLED. Previously allowed higher rate caps (36%) after algorithm changes, but caused excessive volatility. Now uses standard 10% caps.
    - **Coverage Gate** (Feb 2026): If an external API returns fresh data for <70% of celebrities, the entire run treats that source as degraded and uses previous values for everyone. This ensures population consistency - either most people get fresh data, or nobody does that hour. Prevents "mixed freshness" ranking distortions.
    - **Mock Data Safeguard** (Feb 2026): Multi-layer protection against mock data corrupting the database:
      1. **SINGLE AUTHORITATIVE WRITER**: ONLY `server/jobs/ingest.ts` writes to `trending_people`. This is the canonical truth.
      2. **Quick-Score is PREVIEW-ONLY**: `server/jobs/quick-score.ts` computes scores for debugging/preview but does NOT write to DB.
      3. **Storage Layer Guard**: `storage.updateTrendingPeople()` THROWS ERROR if avg fameIndex < 50,000 (real data is 100k-600k range).
      4. **Ingest Guards**: Ingest validates avg fameIndex before writing and uses database transactions for atomicity.
      5. **Row Count Validation**: Before committing, ingest verifies the inserted row count matches expected count. Mismatch triggers rollback.
      6. **Advisory Lock**: Ingest acquires Postgres advisory lock (ID 12345) to prevent concurrent writes. If lock unavailable, job aborts.
      7. **Deprecated Functions**: `getTrendingData()` in api-integrations.ts and all of `lunarcrush.ts` are marked DEPRECATED with console errors if called.
      8. **Critical Architecture Rule**: ONLY ingest.ts writes to trending_people. Quick-score is for preview only. API endpoints NEVER write to trending_people.
    - **Source Health State Machine**: Explicitly tracks the health of each data source (HEALTHY, DEGRADED, OUTAGE, RECOVERY). Used for logging/monitoring only - does NOT affect weight distribution.
    - **Global-Zero Detection**: Requires >50% of celebrities with near-zero values before triggering OUTAGE state (prevents false-positives from individual genuine drops).
    - **Staleness Decay**: Fill-forwarded values gradually reduce over time: 100% (0-2h), 90→70% (2-4h), 70→50% (4-6h), 50→20% (6-12h), 20% floor (>12h).
    - **Velocity Taper** (Feb 2026): When news/search signals are low, velocity contribution is tapered (not mass). Checks 2 signals: newsCount<5, searchVolume<100. Taper multipliers: 0 low=1.0, 1 low=0.85, 2 low=0.65. Mass stays stable as baseline fame; velocity collapses naturally when momentum fades.
    - **Composite Search Activity Score** (Feb 2026): Serper parsing no longer relies on unreliable `totalResults` field. Instead uses a composite score from organic count, knowledge graph presence, news results, related searches, people also ask, and sitelinks.
    - **Cache Validity Gate** (Feb 2026): Serper results with suspiciously low scores (< 10) won't overwrite valid cached data when the drop exceeds 70%. Prevents hours of cached garbage data.
- **Data Jobs**: Ingestion runs hourly, with EMA smoothing applied to `fameIndex` for smooth trend curves.
- **Trend Context Service**: Provides "Why Trending" explanations for top 10 celebrities, categorizing trends, detecting primary/secondary drivers, and tracking data freshness.

### Serverless Architecture
- **Design**: Stateless, with all state managed in Supabase Database.
- **Cron Endpoints**: Scheduled tasks are exposed as authenticated API endpoints for external schedulers.

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schema**: Includes tables for `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, and `celebrity_profiles`.
- **Gamification Schema**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schema**: `prediction_markets`, `market_entries`, `market_bets`.
- **Admin Schema**: `admin_audit_log`.
- **Gamification Service**: Provides functions for XP/credit management and rank calculation.
- **Community Schema**: `community_insights`, `insight_votes`, `insight_comments`, `platform_insights`, `insight_items`, `user_votes`, `user_favourites`.
- **Value Voting Schema**: `celebrity_value_votes` and `celebrity_metrics` for aggregating approval/value data.
- **Aggregate Seed Architecture**: Separates pre-launch seed data from real user votes, storing seed data in dedicated columns within `celebrity_metrics`.

### AI-Generated Celebrity Profiles
- **Feature**: Provides AI-generated biographical data, including bios, known for, origin, location, and net worth, cached for 30 days to minimize API calls.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **GDELT API**: News mention counts, with 4 retries, 20s per-request timeout, 180s batch timeout, jittered delays (800ms base + 500ms jitter).
- **Serper.dev API**: Google search results.
- **X/Twitter API**: Reserved for future Platform Insights feature.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.

### Required Environment Secrets
- `SERPER_API_KEY`
- `X_API_KEY` (for Platform Insights)
- `X_API_SECRET` (for Platform Insights)

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.