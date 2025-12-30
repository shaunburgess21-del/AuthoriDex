# FameDex - Real-Time Fame Tracking Platform

## Overview
FameDex is a real-time celebrity and influencer tracking platform that monitors trending individuals globally. It aggregates data from multiple authoritative sources to display live trending data, including rankings, unified trend scores, and percentage changes. Users can search, filter, sort, and access detailed analytics. The platform aims to be a leading tool for tracking and analyzing global fame, inspired by financial tracking and social trending interfaces.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Technology Stack**: React 18 with TypeScript, Vite, Wouter for routing, TanStack Query for server state, Tailwind CSS for styling.
- **UI/UX**: Radix UI and shadcn/ui (New York style), custom theme with dark/light modes and HSL color tokens, mobile-first responsive design.
- **Design Patterns**: Atomic design, reusable components, feature-specific trending data visualization.
- **State Management**: React Query for server state (5-minute refetch), React hooks for local UI state.
- **Styling**: Design tokens via CSS variables, custom utility classes, glassy neon aesthetic for category pills with specific color mapping for different categories (e.g., Tech: Cyan, Music: Purple).
- **Interactive Elements**: Expandable leaderboard rows with animations, a centralized VotingModal supporting "Vote Next" functionality, and square avatars with rounded corners.
- **Celebrity Profile Vote Tab**: Features "Curate the Profile" section for photo voting on the current celebrity, "Featured Polls" section showing top 3 polls filtered by subject entity with a "View all" modal overlay, positioned between the sentiment voting widget and Community Insights.
- **Page Structure**:
    - **Home Page**: Features a Hero Section, Trend Widgets, Prediction Markets Teaser (carousel), and a filterable/sortable Leaderboard.
    - **Vote Page**: Designed as a "Community Town Hall" with a cyan/teal theme. Includes a gamified XP bar, sections for "Induction Queue" (voting new celebrities), "Curate the Profile" (image hot-or-not), and "The People's Voice" (voting on topics with neon ghost buttons). A floating action button allows suggesting candidates.
    - **Predict Page**: Implements parimutuel prediction markets with a "test mode" using virtual credits, styled with a Royal Purple theme. Features a multi-layer information architecture (Preview, Directory, Deep Dive), a sticky prediction type toggle, global search, category filters, and various market types (Up/Down, Head-to-Head, Category Races, Top Gainer, Community Predictions). A StakeModal handles credit deductions and active predictions.
    - **Me Page**: Placeholder for user profiles, votes, and favorites.

### Backend
- **Technology Stack**: Node.js with Express.js, TypeScript, Drizzle ORM.
- **API Design**: RESTful endpoints with query parameter support, focus on separation of concerns.
- **Data Providers**:
    - `server/providers/wiki.ts` - Fetches Wikipedia pageviews (24h and 7d average) for velocity calculation
    - `server/providers/gdelt.ts` - Fetches GDELT news mention counts for each celebrity
    - `server/providers/serper.ts` - Fetches Google Search results for search volume/delta
    - `server/providers/x-api.ts` - Fetches X/Twitter quote/reply velocity (3x/day, 8-hour cache TTL, ~9K calls/month within 10K Basic tier limit)
- **Scoring Engine** (`server/scoring/`):
    - `normalize.ts` - Fairness algorithm that re-normalizes weights when platforms are missing
    - `trendScore.ts` - Computes final trend score (70% velocity, 30% mass)
    - `utils.ts` - Log-normalization to prevent follower count dominance (10K-1B → 0-100 scale)
- **Data Jobs**:
    - `server/jobs/ingest.ts` - Full data ingestion from all API sources
    - `server/jobs/quick-score.ts` - Fast scoring using cached API data
    - `server/jobs/snapshot-scheduler.ts` - Hourly trend snapshots for chart data (auto-starts with server)

### Data Storage
- **PostgreSQL Database**: Supabase-backed PostgreSQL (FameDex 2026 project) with Drizzle ORM.
    - **Core Schema**: 
        - `users` (authentication + gamification: xpPoints, reputationRank, predictCredits, currentStreak, walletAddress)
        - `tracked_people` (100 celebrities with wikiSlug, xHandle, status: 'main_leaderboard' | 'induction_queue')
        - `trending_people` (calculated rankings and scores)
        - `trend_snapshots` (historical trend data for graphs)
        - `api_cache` (cached API responses with TTL for rate limit management)
        - `celebrity_profiles` (AI-generated biographical data with 30-day caching)
    - **Gamification Schema**:
        - `ranks` (7-tier system: Citizen → Hall of Famer, with XP thresholds and vote multipliers)
        - `votes` (unified polymorphic voting with JSONB metadata for prediction price tracking)
        - `induction_candidates` (potential new celebrities for community voting)
        - `celebrity_images` (multiple photos per celebrity for profile curation)
    - **Community Schema**:
        - `community_insights`, `insight_votes`, `insight_comments`, `comment_votes`
        - `platform_insights`, `insight_items`
        - `user_votes`, `user_favourites`
    - **Migration**: Drizzle Kit with `npx drizzle-kit push`.

### AI-Generated Celebrity Profiles
- **Feature**: Info modal on celebrity profile pages displays AI-generated biographical data.
- **Data Fields**: Short bio, long bio (expandable), known for, origin country, current location, estimated net worth.
- **Caching**: Profiles stored in PostgreSQL `celebrity_profiles` table, regenerated only after 30 days.
- **Cost Control**: 30-day caching minimizes API calls - repeat clicks load from database, not AI.
- **Frontend**: Glass-morphism modal with "Read more" expand/collapse and "Last updated" timestamp.
- **Flags**: Country flags displayed using country-flag-icons (full name on desktop, ISO code on mobile).

## External Dependencies

### Third-Party API Services (Active)
- **Wikipedia API**: Free pageview data (24h and 7d averages)
- **GDELT API**: Free news mention counts and trends
- **Serper.dev API**: Google search results for search volume (API key required)
- **X/Twitter API**: Quote/reply velocity metrics (Basic tier, 10K reads/month)
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono
- **Supabase**: PostgreSQL database provider (FameDex 2026 project)

### Required Environment Secrets
- `SERPER_API_KEY` - For Google search data
- `X_API_KEY` - X/Twitter API key
- `X_API_SECRET` - X/Twitter API secret

### Key Libraries
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.
- **Session Management**: connect-pg-simple (for PostgreSQL).