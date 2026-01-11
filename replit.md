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
- **Global Favorites Filter**: Universal filter appearing after "All" in every category filter row across the app
    - **Star Icon**: Displays Star icon + "Favorites" text on desktop, icon-only on mobile for space efficiency
    - **Auth-Gated**: Clicking when logged out redirects to /login; when logged in, filters data by user's favorited celebrities
    - **Locations**: VotePage (8 filter instances), PredictPage (global + section filters + overlays), VoteDeckView, PredictDeckView
    - **Data Sources**: `client/src/data/vote.ts` (FILTER_CATEGORIES), `client/src/data/predict.ts` (CATEGORY_FILTERS)
- **Compare Momentum Graph**: Bloomberg-style momentum comparison chart with:
    - **Time Range Toggles**: 7D (default), 30D, 90D, ALL - config-driven via `TIME_RANGE_OPTIONS` constant
    - **High-Contrast Color Palette**: Cyan (#22D3EE), Violet (#A855F7), Emerald (#10B981), Amber (#F59E0B), Rose (#F43F5E)
    - **Fallback Data Generation**: When historical data < 3 days, generates simulated realistic trends
    - **Rich Tooltips**: Glassmorphism-styled tooltip showing date + all celebrities sorted by score
    - **Interactive Legend**: Click celebrity names to show/hide lines
    - **Category Filtering**: Top 5 overall or filtered by category (Tech, Music, Politics, Sports, Creator)
- **Page Structure**:
    - **Home Page**: Features a Hero Section, Trend Widgets, Prediction Markets Teaser (carousel), and a filterable/sortable Leaderboard.
    - **Vote Page**: Designed as a "Community Town Hall" with a cyan/teal theme. Reorganized layout prioritizes engagement:
        - **Zone 1 (Public Opinion)**: Face-Offs (A vs B binary choices with premium Versus cards) → People's Voice (voting on topics with neon ghost buttons)
        - **Governance Header Divider**: Shows "Community Governance" badge, "Shape the FameDex" title, and stats (Total Votes Cast, Next Governance Update). Conditionally visible only when All, Induction Queue, or Curate Profile is selected.
        - **Zone 3 (Governance)**: Induction Queue (voting new celebrities) → Curate the Profile (image hot-or-not)
        - Helper functions: `isGovernanceSection()` and `isPublicOpinionSection()` control section visibility
        - Sticky filter bar with section tabs, global search, and category pills
        - A floating action button allows suggesting candidates.
    - **Predict Page**: Implements parimutuel prediction markets with a "test mode" using virtual credits, styled with a Royal Purple theme. Features a multi-layer information architecture (Preview, Directory, Deep Dive), a sticky prediction type toggle, global search, category filters, and various market types (Up/Down, Head-to-Head, Category Races, Top Gainer, Community Predictions). A StakeModal handles credit deductions and active predictions.
    - **Me Page**: User account dashboard showing XP, credits, rank, votes, and predictions.
        - Sub-routes: `/me/votes`, `/me/predictions`, `/me/favorites`, `/me/settings`
        - RankBadge component with 7-tier color-coded styling
        - Settings page for profile updates (username, display name, privacy toggle)
    - **Public Profiles**: `/u/:username` route shows public user profiles with XP progress, voting stats
        - Privacy toggle (isPublic) controls visibility - private profiles show "Private Profile" message
    - **Admin Panel**: `/admin` route for comprehensive site management (admin-only access)
        - Protected by requireAuth + requireAdmin middleware (validates Supabase JWT)
        - Frontend uses `fetchWithAuth` helper to send Authorization: Bearer tokens
        - **Sidebar Navigation**: Overview, Celebrities, Game CMS, Moderation, Settlement, Users, System Tools
        - **Overview**: Stats dashboard (users, celebrities, votes, predictions), traffic analytics, audit log viewer showing recent admin actions
        - **Celebrities**: Full CRUD for tracked_people table with search, add/edit/delete modals, category and status management
        - **Game CMS**: Prediction market manager, Face-Off CRUD with title/category/options, Induction queue approvals
        - **Moderation**: Content moderation for community insights and comments with delete functionality
        - **Settlement Center**: Resolve closed markets, distribute payouts, view settlement history
        - **Users & Moderation**: Search users, adjust credits (with confirmation modal + "ADJUST" safety), ban users, view user details
        - **System Tools**: Manual triggers for data refresh, scoring engine, snapshot capture
        - All admin write actions logged to `admin_audit_log` table for audit trail (13 logging points covering all CRUD operations)

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
    - `server/jobs/snapshot-scheduler.ts` - Hourly trend snapshots for chart data (auto-starts with server unless serverless mode)

### Serverless Architecture (Vercel-Ready)
- **Stateless Design**: All state stored in Supabase Database, no local file or in-memory persistence
- **Environment Detection**: `SERVERLESS_MODE=true` or `VERCEL=1` disables background schedulers
- **Modular Services**: Business logic (gamification, scoring) separated from API routes for portability
- **Cron Endpoints**: Scheduled tasks exposed as standalone API endpoints:
    - `POST /api/cron/capture-snapshots` - Hourly trend snapshots (trigger via external scheduler)
    - `POST /api/cron/refresh-data` - Data ingestion from APIs (trigger every 8 hours)
    - `POST /api/cron/run-scoring` - Re-calculate trend scores on demand
    - `GET /api/cron/health` - Health check for cron monitoring
- **Cron Authentication**: Set `CRON_SECRET` env var; endpoints require `Authorization: Bearer <secret>` header
- **No Hardcoded URLs**: Use `process.env.BASE_URL` or `window.location.origin` for all redirects/callbacks

### Data Storage
- **PostgreSQL Database**: Supabase-backed PostgreSQL (FameDex 2026 project) with Drizzle ORM.
    - **Core Schema**: 
        - `users` (authentication + gamification: xpPoints, reputationRank, predictCredits, currentStreak, walletAddress)
        - `tracked_people` (100 celebrities with wikiSlug, xHandle, status: 'main_leaderboard' | 'induction_queue')
        - `trending_people` (calculated rankings and scores)
        - `trend_snapshots` (historical trend data for graphs)
        - `api_cache` (cached API responses with TTL for rate limit management)
        - `celebrity_profiles` (AI-generated biographical data with 30-day caching)
    - **Gamification Schema (Phase 1 - Ledger-Based Economy)**:
        - `xp_ledger` (immutable XP transaction log - source of truth, with idempotency keys, metadata JSONB)
        - `credit_ledger` (immutable credit transaction log with wallet_type: 'VIRTUAL'|'REAL', balanceAfter snapshots)
        - `xp_actions` (data-driven XP values and daily caps - Game Master table)
        - `ranks` (7-tier system: Citizen → Hall of Famer, with XP thresholds and vote multipliers)
        - `votes` (unified polymorphic voting with JSONB metadata for prediction price tracking)
        - `induction_candidates` (potential new celebrities for community voting)
        - `celebrity_images` (multiple photos per celebrity for profile curation)
        - `face_offs` (A vs B binary choice voting questions with category, title, optionA/optionB text/image, displayOrder for admin ordering)
        - `profiles` (user profiles keyed by Supabase Auth ID, with username, fullName, avatarUrl, isPublic, role, rank, XP/votes/predictions stats)
    - **Prediction Markets Schema**:
        - `prediction_markets` (marketType, status: OPEN|CLOSED_PENDING|RESOLVED|VOID, title, slug, rules, metadata, startAt, endAt, createdBy, settledBy)
        - `market_entries` (options/candidates within a market, linked to prediction_markets, entryType: person|custom, displayOrder, totalStake, resolutionStatus)
        - `market_bets` (user stakes on market entries, stakeAmount, status: active|won|lost|void|refunded, payoutAmount)
    - **Admin Schema**:
        - `admin_audit_log` (immutable record of admin actions: adminId, actionType, targetTable, targetId, previousData, newData, metadata)
    - **Gamification Service** (`server/services/gamification.ts`):
        - `awardXp()` - Awards XP with daily cap enforcement, idempotency, auto-rank recalculation
        - `adjustCredits()` - Credit transactions with audit trail (balanceAfter snapshots)
        - `checkPermission()` - Abstract capability checks (can_post_insight, can_vote_induction, etc.)
        - `recalculateUserRank()` - Updates user rank based on XP thresholds
        - `getVoteMultiplier()` - Returns rank-based vote weight (1.0x for Face-Offs/Polls for "1 Person = 1 Vote" integrity)
    - **Security**: XP/credit endpoints restricted to whitelisted actions; high-value awards (prediction_win, bonuses) server-side only
    - **Admin Backdoor**: shaun.burgess21@gmail.com auto-assigned admin role + "Hall of Famer" rank + 100,000 XP on signup
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