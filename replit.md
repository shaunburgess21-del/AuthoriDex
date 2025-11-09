# FameDex - Real-Time Fame Tracking Platform

## Overview

FameDex is a real-time celebrity and influencer tracking platform that monitors trending people worldwide by aggregating data from multiple authoritative sources. The application displays live trending data with rankings, unified trend scores, and percentage changes over 24-hour and 7-day periods. Users can search, filter by category, and sort trending individuals while viewing detailed analytics for each person.

**Current Status:** ✅ Design/UX Ready - Mock data mode + Supabase schema prepared
- ✅ **MOCK DATA MODE ACTIVE** - Real APIs replaced with realistic mock data for design work
- ✅ All 100 people tracked successfully (no API rate limiting)
- ✅ Realistic trend scores (100k-500k range) with varied percentage changes
- ✅ 30 days of historical data for trend graphs (1D, 7D, 30D, ALL)
- ✅ Real 24h/7d percentage changes (e.g., -4.48%, +29.47%)
- ✅ PostgreSQL database with unique constraint preventing duplicates
- ✅ 30-second cache for fast design iteration
- ✅ Stable midnight UTC timestamps for historical data consistency
- ✅ Avatar initials display (e.g., "EM" for Elon Musk)
- ✅ Load More pagination (20 at a time, up to 100)
- ✅ Clickable daily/weekly mover widgets
- ✅ **Platform Insights** - Rich platform-specific content analytics with follower counts
- ✅ **Sentiment Voting (Animated Segmented Design)** - Exact Figma match with 10 vivid gradient segments (#FF0000→#00C853), progressive fill, line-style needle centered in segments, and full column clickability
- ✅ **Enhanced Profile Pages** - Reorganized layout with Card-based stats and prominent sentiment widget placement
- ✅ **Telemetry Logging** - User interaction tracking (vote_submitted, insight_modal_open, insight_post_open)
- ✅ **Accessibility** - Full keyboard support for sentiment voting (arrow keys, Home/End, Enter/Space) with ARIA attributes
- ✅ **Supabase Ready**: Complete schema with voting, RLS, realtime, and api views created
- 📋 **NEXT PHASE**: Migrate to Supabase + upgrade to premium APIs before launch

The platform draws design inspiration from financial tracking platforms (CoinMarketCap, Yahoo Finance) and social trending interfaces (Twitter/X), emphasizing data-first hierarchy and quick-scan optimization.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching
- Tailwind CSS for utility-first styling with custom design tokens

**UI Component System:**
- Radix UI primitives for accessible, unstyled component foundations
- shadcn/ui component library (New York style variant) providing pre-built components
- Custom theme system supporting dark/light modes with HSL color tokens
- Responsive design with mobile-first breakpoints

**Key Design Decisions:**
- **Component Architecture**: Atomic design pattern with reusable UI components in `/client/src/components/ui/` and feature-specific components for trending data visualization
- **State Management**: Server state handled by React Query with 5-minute refetch intervals for live data updates; local UI state managed via React hooks
- **Routing Strategy**: File-based route components in `/client/src/pages/` using Wouter for minimal bundle size
- **Styling Approach**: Design tokens defined in CSS variables for consistent theming; custom utility classes for hover/active elevation effects

### Backend Architecture

**Technology Stack:**
- Node.js with Express.js for the REST API server
- TypeScript for type safety across the stack
- Drizzle ORM for database operations
- In-memory storage with planned PostgreSQL database support

**API Design:**
- RESTful endpoints for trending data retrieval and filtering
- Query parameter support for search, category filtering, and sorting
- Separation of concerns with dedicated route handlers in `/server/routes.ts`
- Multi-source API aggregation system in `/server/api-integrations.ts`

**Mock Data System (CURRENTLY ACTIVE):**
- **Purpose**: Enable design/UX iteration without API rate limiting constraints
- **Trending Data Generation**:
  - `generateMockMetrics()`: Creates varied trend scores (100k-500k) using name-based seeding
  - `generateMockHistoricalData()`: Creates 30 days of historical snapshots with growth pattern
  - Formula: `500000 - (index * 4000) - (Math.sin(seed) * 20000)`
  - Historical pattern: `currentScore * (1 - daysAgo/40 + Math.sin(daysAgo*0.5)*0.15)`
- **Platform Insights Generation**:
  - `generateMockPlatformInsights()`: Creates realistic platform-specific content insights
  - Platforms: X/Twitter, YouTube, Instagram, TikTok, Spotify, News
  - Each platform has 2 insight types (e.g., Most Liked Tweet, Most Retweeted)
  - Each insight has 5 ranked items with decreasing metric values
  - Metrics: Twitter (250K-750K likes), YouTube (5M-15M views), Instagram (800K-1.8M likes), TikTok (10M-30M views), Spotify (50M-150M plays), News (500K-1.5M views)
  - Includes title, metric value, optional link/image, timestamp for each item
  - **Follower Counts**: Mock follower/subscriber counts per platform (X: 1M-51M followers, YouTube: 500K-20.5M subscribers, Instagram: 2M-102M followers, TikTok: 5M-155M followers, Spotify: 100K-10.1M listeners)
- **Sentiment Voting (Animated Segmented Design) - Exact Figma Match**:
  - **Implementation**: `AnimatedSentimentVotingWidget.tsx` using Framer Motion for smooth animations
  - **Title & Copy**: "Cast Your Vote" with gradient text effect + "How do you feel about {PersonName}?" subtitle
  - **10 Segmented Pill Bars**: Individual rounded pill segments with gaps (not one solid bar)
    - **Thin Height**: h-3.5 (14px) for sleek, modern appearance
    - **Progressive Fill Effect**: Only segments 1 to selected value are vibrant; remaining segments very dim/dark
  - **Exact Figma Color Palette** (SEGMENT_COLORS array):
    - Segment 1: Pure vivid red - `#FF0000`
    - Segment 2: Bright crimson - `#FF1744`
    - Segment 3: Vivid orange - `#FF6D00`
    - Segment 4: Bright orange - `#FF9100`
    - Segment 5: Golden amber - `#FFC400`
    - Segment 6: Brilliant yellow - `#FFEA00`
    - Segment 7: Electric lime - `#C6FF00`
    - Segment 8: Neon green - `#76FF03`
    - Segment 9: Vibrant emerald - `#00E676`
    - Segment 10: Pure green - `#00C853`
  - **Line-Style Needle** (Centered in Segments):
    - Vertical colored line extending upward from selected segment
    - **Positioning Formula**: `left: ((displayValue - 0.5) / 10) * 100%` centers needle at segment midpoints
    - Positions: Segment 1→5%, Segment 5→45%, Segment 10→95%
    - **Hollow Circle** at bottom: 3px white border, transparent center, colored glow effect
    - Inline styles guarantee border rendering: `borderWidth: '3px', borderColor: '#ffffff', backgroundColor: 'transparent'`
    - Smooth spring animation (stiffness: 400, damping: 25) via Framer Motion's `animate` prop
    - Scales up when dragging (1.15x)
  - **Zone Labels**: Hate, Dislike, Neutral, Like, Love as speech bubbles above segments
    - Active zone gets white glow (drop-shadow animation)
    - pointer-events-none for click-through to segments
  - **Number Labels**: 1-10 displayed below segments
    - Animated: scale 1.3x and fontWeight 700 when selected
    - Full vertical column clickability (bubble + segment + number)
  - **Updated Feedback**: "Your Vote: X/10 - [Zone]" with approval messages
    - Messages: "strongly disapprove", "disapprove of", "neutral about", "approve of", "strongly approve of"
  - **Strategic Placement**: Positioned BETWEEN stats cards and Trend History chart for maximum engagement
  - **Accessibility**: Full keyboard navigation (arrow keys, Home/End, Enter/Space), ARIA slider role, screen reader support
  - **localStorage persistence** for user's vote (ready for Supabase migration)
  - **Telemetry logging** for vote_submitted events with personId and value
- **Duplicate Prevention**:
  - Unique constraint on (person_id, timestamp) in trend_snapshots table
  - Stable midnight UTC timestamps for historical data
  - One-time historical generation per person (3200 total snapshots: 100 people × 32)
- **Performance**:
  - 30-second cache for fast design iteration
  - ~60 second initial generation (includes historical data)
  - ~7 second subsequent loads (current snapshot only)
  - 120-second timeout for safety
- **Console Log**: "🎭 Using MOCK DATA for 100 tracked people (design mode)"

**Real API Integration Architecture (FOR FUTURE USE):**
- **Data Aggregation**: Combines data from 4 external APIs (News, YouTube, Spotify, SERP) into unified trending scores
- **Balanced Scoring Algorithm**: 
  - All metrics normalized to 0-1000 range for fair comparison
  - Weighted combination: 30% news mentions, 25% YouTube views, 25% Spotify followers, 20% search trends
  - Final scores scaled to 100k-500k range for visual impact
- **Note**: Currently disabled in favor of mock data for design work. Will be re-enabled with premium API tiers (Twitter/X, TikTok, Meta) before launch.

**Key Design Decisions:**
- **Data Layer**: Abstracted storage interface (`IStorage`) allowing swappable implementations (in-memory vs. database)
- **Middleware Pattern**: Request logging, JSON parsing, and error handling implemented as Express middleware
- **Development Mode**: Vite integration in development for HMR; static file serving in production
- **API Integration**: Real-time multi-source aggregation with intelligent caching and error handling

### Data Storage Solutions

**Current Implementation:**
- In-memory storage using Map data structures for development/testing
- Storage interface pattern allowing seamless migration to persistent databases

**Database Schema (PostgreSQL with Drizzle ORM):**
- `users` table: Authentication and user management (id, username, password)
- `trending_people` table: Trending person data with metrics (id, name, avatar, rank, trendScore, change24h, change7d, category)
- UUID primary keys with automated generation
- Type-safe schema definitions shared between client and server via `/shared/schema.ts`

**Migration Strategy:**
- Drizzle Kit configured for PostgreSQL dialect
- Migration files output to `/migrations` directory
- Environment-based database URL configuration

### External Dependencies

**Third-Party API Services (Active):**
- **News API**: Tracks celebrity mentions in news articles (100 requests/day free tier)
- **YouTube Data API**: Monitors video views and popularity (10,000 units/day quota)
- **Spotify Web API**: Fetches artist follower counts (requires CLIENT_ID and CLIENT_SECRET)
- **SERP API (Google Trends)**: Tracks search interest trends over time
- **Google Fonts**: Typography loading (Inter, Space Grotesk, JetBrains Mono)
- **Neon Database**: PostgreSQL database provider via `@neondatabase/serverless`

**Key Libraries:**
- **UI Components**: Radix UI component primitives for accessibility
- **Form Handling**: React Hook Form with Zod validation via `@hookform/resolvers`
- **Data Visualization**: Recharts for visually appealing trend charts with responsive design
- **Date Utilities**: date-fns for temporal data formatting
- **Session Management**: connect-pg-simple for PostgreSQL-backed sessions

**Development Tools:**
- Replit-specific plugins for development banner and error overlay
- ESBuild for production server bundling
- PostCSS with Autoprefixer for CSS processing

**Authentication System:**
- Session-based authentication structure in place
- User schema with hashed password storage
- Credential-based fetch requests for session persistence