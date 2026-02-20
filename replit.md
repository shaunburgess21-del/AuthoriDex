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
- **Page Structure**: Core pages include Home, Vote, Predict, Me, Public Profiles, and an Admin Panel for site management.

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
    - Implements a Two-Speed Leaderboard Pipeline for hourly full refreshes and fast-lane 10-minute ticks based on internal signals.

### Serverless Architecture
- **Design**: Stateless, using Supabase Database for all state management.
- **Cron Endpoints**: Authenticated API endpoints for scheduled tasks.

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schemas**: `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`.
- **Gamification Schemas**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schemas**: `prediction_markets`, `market_entries`, `market_bets`, `open_market_comments`.
- **Community Schemas**: `community_insights`, `insight_votes`, `insight_comments`, `platform_insights`, `insight_items`, `user_votes`, `user_favourites`.
- **Value Voting**: `celebrity_value_votes`, `celebrity_metrics` for approval/value aggregation.
- **AI-Generated Celebrity Profiles**: Cached biographical data.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **Mediastack API**: Primary news article counts (Professional plan, 50k calls/month).
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