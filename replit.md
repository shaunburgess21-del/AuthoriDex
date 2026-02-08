# FameDex - Real-Time Fame Tracking Platform

## Overview
FameDex is a real-time platform designed to track trending celebrities and influencers globally. It aggregates data from various sources to provide live trend rankings, unified trend scores, and percentage changes. The platform aims to be a leading tool for analyzing global fame, offering search, filter, sort, and detailed analytics capabilities, inspired by financial tracking and social trending interfaces. It includes features like prediction markets and gamified user interactions.

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
    - **Normalization & Stabilization**: Per-source normalization using `log1p` and percentile ranking; multi-layered stabilization prevents fluctuations with dynamic rate limiting, spike detection, and dynamic EMA alpha.
    - **Auto Catch-Up Mode**: Three-band gap-driven rate boosting for data ingestion, with state persisted in the database.
    - **Robustness**: Graceful degradation handles external API failures, and a coverage gate ensures data consistency.
    - **Data Integrity**: Multi-layer protection against mock data corruption, strict writing protocols for `trending_people` via `ingest.ts`, and DB-level guardrails for `trend_snapshots`.
    - **Trend Context**: AI-generated "Why Trending" summaries (`gpt-4o-mini`) with sophisticated caching and rate limiting, providing 1-2 sentence summaries and categories. Non-AI trend context uses keyword matching for driver detection.
    - **Velocity Taper**: Tapers velocity contribution when news/search signals are low to maintain stable mass while reflecting fading momentum.
    - **Search & Wiki Improvements**: Composite Search Activity Score, Cache Validity Gate for Serper results, Search Query Override for disambiguation, and Wiki Velocity Smoothing using 7-day rolling averages.
    - **Snapshot Diagnostics**: `diagnostics` JSONB column in `trend_snapshots` stores versioned debug data per snapshot.
    - **Entity Resolution Diagnostics**: Admin tools to verify Serper search results match intended celebrities.

### Serverless Architecture
- **Design**: Stateless, using Supabase Database for all state management.
- **Cron Endpoints**: Authenticated API endpoints for scheduled tasks.

### Data Storage
- **Database**: Supabase-backed PostgreSQL with Drizzle ORM.
- **Core Schemas**: `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`.
- **Gamification Schemas**: `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`.
- **Prediction Markets Schemas**: `prediction_markets`, `market_entries`, `market_bets`.
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