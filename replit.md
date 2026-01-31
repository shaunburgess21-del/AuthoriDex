# FameDex - Real-Time Fame Tracking Platform

## Overview
FameDex is a real-time celebrity and influencer tracking platform designed to monitor trending individuals globally. It aggregates data from multiple authoritative sources to provide live trending data, including rankings, unified trend scores, and percentage changes. The platform allows users to search, filter, sort, and access detailed analytics, aiming to become a leading tool for tracking and analyzing global fame, inspired by financial tracking and social trending interfaces.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS.
- **UI/UX**: Radix UI and shadcn/ui (New York style), custom theme with dark/light modes and HSL color tokens, mobile-first responsive design.
- **Styling**: Design tokens via CSS variables, custom utility classes, glassy neon aesthetic.
- **Interactive Elements**: Expandable leaderboard rows, a centralized VotingModal with "Vote Next" functionality, and square avatars with rounded corners.
- **Features**: Global Favorites Filter, Custom Topic Support, unified "+ Suggest" buttons, and a Bloomberg-style Compare Momentum Graph with time range toggles, high-contrast color palette, and interactive legend.
- **Page Structure**:
    - **Home Page**: Hero Section, Trend Widgets, Prediction Markets Teaser, filterable/sortable Leaderboard.
    - **Vote Page**: "Community Town Hall" theme, featuring Face-Offs, People's Voice, Induction Queue, and Curate Profile sections. Includes a sticky filter bar and a floating action button for suggestions.
    - **Predict Page**: Parimutuel prediction markets with a "test mode", multi-layer information architecture, sticky prediction type toggle, and various market types.
    - **Me Page**: User account dashboard with XP, credits, rank, votes, and predictions, including sub-routes for detailed views.
    - **Public Profiles**: User profiles showing XP progress and voting stats, with privacy controls.
    - **Admin Panel**: Comprehensive site management with protected routes, sidebar navigation, and modules for managing celebrities, games, moderation, settlement, users, and system tools. All admin actions are logged.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints with query parameters.
- **Data Providers**: Integrates with Wikipedia, GDELT, and Serper.dev APIs for celebrity data.
  - **Note (Jan 2026)**: X/Twitter API removed from trend score engine due to cost constraints. X API keys preserved for future Platform Insights feature.
- **Scoring Engine** (Refactored Jan 2026):
  - **Fame Score (0-1,000,000)**: Primary UI score displayed everywhere, computed from normalized trend score. Scale expanded to 0-1,000,000 for greater variance, larger numbers, and prediction difficulty.
  - **Fixed Weights**: Mass (40%) + Velocity (60%), no dynamic redistribution to prevent scoring discontinuities.
  - **Active Velocity Sources**: Wiki (25%), News (35%), Search (40%) - X API disabled (0%).
  - **Anti-Spam Damping**: `VelocityAdjusted = VelocityScore × (0.35 + 0.65 × MassScore)` ensures high-velocity/low-mass accounts are penalized.
  - **Diversity Multiplier**: Silent penalty based on active platforms. Instagram/YouTube/X marked as NOT_APPLICABLE. Wiki+News+Search = 3/3 active = 1.0x multiplier.
  - **Wiki-as-Primary-Mass**: Wikipedia pageviews serve as the primary mass signal (50% weight).
  - **EMA Smoothing**: Alpha = 0.08 applied to final scores for smooth, stock-market-style curves (reduced from 0.15 for gentler transitions).
  - **Nullable Change Values**: change24h/change7d show "N/A" when data is unavailable (no fake random values).
- **Data Jobs** (Refactored Jan 2026):
  - **Single Snapshot Source**: Only `ingest.ts` writes to `trend_snapshots` table. Other jobs (`quick-score.ts`, `snapshot-scheduler.ts`) are disabled for snapshot writing to prevent duplicate data points.
  - **Hourly Truncation**: Timestamps truncated to the hour with `onConflictDoNothing` for idempotency. Unique constraint on (person_id, timestamp) enforced at DB level.
  - **Ingestion Interval**: Full data ingestion runs every 60 minutes.
  - **EMA Smoothing**: Applied to fameIndex during ingestion for smooth, stock-market-style trend curves.
- **Trend Context Service** (Jan 2026): Provides "Why Trending" explanations via `getTrendContext()` and `getTrendContextBatch()`.
  - **Top 10 Only (Jan 2026)**: "Why They're Trending" section only displays for top 10 ranked celebrities. Lower-ranked celebrities have stale/irrelevant news, so the section is hidden to improve UX and reduce AI costs.
  - **Keyword Mapper**: 14 categories (Earnings, Legal News, Music, Politics, Sports, Entertainment, Personal Life, Breaking News, Viral Moment, Heated, Announcement, Public Appearance, Tech News, Business).
  - **Confidence Thresholds**: Requires >= 2 keyword matches for confident tagging; falls back to "In The News" for low confidence.
  - **Driver Detection**: Determines primary/secondary trend drivers (NEWS, SEARCH, SOCIAL, WIKI) based on signal strength.
  - **Data Freshness**: Tracks per-source timestamps (wiki, news, search, x) with stale detection (> 1 hour).
  - **Sentiment Voting**: `sentimentVotes` table with 1 vote per user per person per day rate limiting.
- **Leaderboard Tabs** (Jan 2026): Three-tab system replacing All/Risers/Fallers:
  - **Fame Score Tab**: Sorted by fameIndex score (default), standard layout with Vote button
  - **Approval Tab**: Sorted by approval percentage from community votes, violet styling
  - **Value Tab**: Sorted by value score (-100 to +100), inline Underrated/Overrated voting buttons, amber styling
  - **Sort Toggle**: Clicking the same tab again toggles between ascending/descending sort

### Serverless Architecture
- **Design**: Stateless, with all state managed in Supabase Database.
- **Environment Detection**: Supports serverless environments by disabling background schedulers.
- **Cron Endpoints**: Scheduled tasks exposed as authenticated API endpoints for external schedulers (e.g., `capture-snapshots`, `refresh-data`, `run-scoring`).

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schema**: `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`.
- **Gamification Schema**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schema**: `prediction_markets`, `market_entries`, `market_bets`.
- **Admin Schema**: `admin_audit_log`.
- **Gamification Service**: Provides functions for `awardXp()`, `adjustCredits()`, `checkPermission()`, `recalculateUserRank()`, and `getVoteMultiplier()`.
- **Security**: XP/credit endpoints restricted to whitelisted actions; high-value awards are server-side only.
- **Community Schema**: `community_insights`, `insight_votes`, `insight_comments`, `comment_votes`, `platform_insights`, `insight_items`, `user_votes`, `user_favourites`.
- **Value Voting Schema** (Jan 2026): `celebrity_value_votes` (underrated/overrated votes, 1 per user per celebrity), `celebrity_metrics` (aggregated approval/value metrics for fast leaderboard sorting).
- **Aggregate Seed Architecture** (Jan 2026): Clean separation of pre-launch seed data from real user votes.
  - **Seed Columns**: `celebrity_metrics` stores seed data in dedicated columns: `seed_approval_count`, `seed_approval_sum`, `seed_underrated_count`, `seed_overrated_count`.
  - **Display Formula**: Display values combine seed + real: `display_total = seed_total + real_total`.
  - **Approval Formula**: `approval_pct = ((avg_rating - 1) / 4) * 100` maps 1-5 stars to 0-100%.
  - **Value Seeding**: Deterministic script (`scripts/seed-value-aggregates.ts`) populates value seed columns based on fameIndex ranking.
  - **No Fake Users**: All seed data is stored as aggregates, not individual vote rows, keeping the database clean for analytics.

### AI-Generated Celebrity Profiles
- **Feature**: Provides AI-generated biographical data for celebrities, including short/long bios, known for, origin, location, and net worth.
- **Caching**: Profiles are stored in the database and regenerated only after 30 days to minimize API calls.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **GDELT API**: News mention counts.
- **Serper.dev API**: Google search results.
- **X/Twitter API**: Reserved for future Platform Insights feature (not used in trend scoring).
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.

### Required Environment Secrets
- `SERPER_API_KEY`
- `X_API_KEY` (reserved for Platform Insights)
- `X_API_SECRET` (reserved for Platform Insights)

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.

## Industry Categories
The platform uses the following industry categories for classifying celebrities:
- **Tech**: Technology leaders, entrepreneurs, and innovators
- **Entertainment**: Actors, musicians, performers, and entertainment personalities (consolidated from separate "Music" category in Jan 2026)
- **Sports**: Athletes and sports figures
- **Politics**: Politicians and political figures
- **Business**: Business leaders and executives
- **Creator**: Content creators, influencers, and digital personalities

Note: The Trend Context Service uses separate content-type tags (like "Music" for album/tour news) to explain why someone is trending, independent of their primary industry category.