# AuthoriDex - Real-Time Authority Tracking Platform

## Overview
AuthoriDex is a real-time platform for tracking trending celebrities and influencers globally. It aggregates data from various sources to provide live trend rankings, unified trend scores, and percentage changes. The platform aims to be a leading tool for analyzing global fame, offering search, filter, sort, and detailed analytics capabilities, inspired by financial tracking and social trending interfaces. Key features include prediction markets and gamified user interactions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS.
- **UI/UX**: Radix UI and shadcn/ui (New York style) with custom dark/light themes, HSL color tokens, and a glassy neon aesthetic. Features a mobile-first responsive design.
- **Key Features**: Global Favorites Filter, Custom Topic Support (uses `misc` as internal category ID, displayed as "Custom Topic" via CategoryPill label mapping), "+ Suggest" buttons, Bloomberg-style Compare Momentum Graph.
- **Page Structure**: Core pages include Home, Vote, Predict, Me, Public Profiles, Prediction Leaderboard, and an Admin Panel.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints.
**Scoring Engine**: Calculates a Fame Score (0-1,000,000) based on Mass (40%) and Velocity (60%), with Velocity sources from Wikipedia (25%), News (35%), and Search (40%). Features per-source normalization, percentile ranking, multi-layered stabilization, circuit breakers, stale cache fallbacks, and adaptive request spacing. It generates AI-powered "Why Trending" summaries using `gpt-4o`, tracks ingestion runs, and provides an Engine Health Dashboard. It also includes a cascading news provider hierarchy (Mediastack → GDELT → Serper News), per-person news fallback, degradation governor, and an EMA Hold Rule to prevent leaderboard whiplash. A "Canary People List" acts as an early-warning system for data source issues. Boot timestamp `[BOOT]` with NODE_ENV is logged on every startup for restart diagnostics.
- **Process Resilience**: SIGHUP signals are caught and ignored (kept alive). Vite/esbuild `process.exit(1)` calls are intercepted and suppressed to prevent cascading crashes from esbuild service restarts. Real fatal errors (uncaughtException, unhandledRejection) bypass the guard and exit immediately via `_origExit`. Signal handlers cover SIGTERM, SIGINT, SIGHUP, and exit.
- **Serverless Architecture**: Stateless design, using Supabase Database for all state management with authenticated API endpoints for scheduled tasks.
- **Image Storage Architecture**: Utilizes Supabase Storage Buckets for optimized WebP images across various sizes, with a robust `imageResolver` for contextual cascading URL fallbacks.
- **Data Storage**: Supabase-backed PostgreSQL with Drizzle ORM. Core schemas include `users`, `tracked_people`, `trending_people`, `trend_snapshots`, `api_cache`, `celebrity_profiles`. Gamification schemas cover `xp_ledger`, `credit_ledger`, `xp_actions`, `ranks`, `votes`, `induction_candidates`, `celebrity_images`, `face_offs`, `profiles`. Prediction market schemas include `prediction_markets`, `market_entries`, `market_bets`, `open_market_comments`. The system ensures robust payout pipeline hardening with immutable ledger entries and idempotency keys, comprehensive admin tools for credit reconciliation, market settlement, and user credit history.

## External Dependencies

### Third-Party API Services
- **Wikipedia API**: Pageview data.
- **Mediastack API**: Primary news article counts.
- **GDELT API**: Secondary news mention counts.
- **Serper.dev API**: Google search results and emergency news fallback.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Supabase**: PostgreSQL database provider.
- **OpenAI**: `gpt-4o` for AI-generated summaries.

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.