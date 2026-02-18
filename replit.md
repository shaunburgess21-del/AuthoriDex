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
    - Includes Serper News Fallback for automatic news source switching when GDELT coverage drops.
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
- **GDELT API**: News mention counts.
- **Serper.dev API**: Google search results.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.
- **OpenAI**: `gpt-4o-mini` for AI-generated summaries.

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.