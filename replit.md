# FameStreem - Real-Time Fame Tracking Platform

## Overview

FameStreem is a real-time celebrity and influencer tracking platform that monitors trending people worldwide by aggregating data from multiple authoritative sources. The application displays live trending data with rankings, unified trend scores, and percentage changes over 24-hour and 7-day periods. Users can search, filter by category, and sort trending individuals while viewing detailed analytics for each person.

**Current Status:** 🚧 Beta - Live API integrations active, historical tracking pending
- ✅ Multi-source data aggregation from News API, YouTube, Spotify, and Google Trends
- ✅ Balanced scoring algorithm combining 4 data streams with real-time metrics
- ✅ 15 high-profile celebrities tracked across Music, Sports, Politics, Tech, and Entertainment
- ✅ 30-minute intelligent caching with graceful error handling
- ✅ Real-time leaderboard with search, filters, and category sorting
- ⏳ **TODO**: Historical data tracking for accurate 24h/7d change calculations (currently using placeholder values)
- ⏳ **TODO**: Expand celebrity roster or adjust UI copy (currently 15 vs promised 1000)
- ⏳ **TODO**: Complete Spotify integration (requires SPOTIFY_CLIENT_SECRET environment variable)

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

**Multi-API Integration Architecture:**
- **Data Aggregation**: Combines data from 4 external APIs (News, YouTube, Spotify, SERP) into unified trending scores
- **Balanced Scoring Algorithm**: 
  - All metrics normalized to 0-1000 range for fair comparison
  - Weighted combination: 30% news mentions, 25% YouTube views, 25% Spotify followers, 20% search trends
  - Final scores scaled to 100k-500k range for visual impact
- **Performance Optimization**:
  - 30-minute cache duration to respect API rate limits
  - Fetch locking prevents simultaneous API calls (thundering herd protection)
  - AbortController-based timeouts (5s per API, 15s total) prevent hung requests
  - Stale cache fallback on errors ensures continuous availability
- **Error Resilience**: 
  - Failed API calls return 0 (graceful degradation)
  - Zero-score entries filtered from results
  - Missing credentials fail fast (e.g., Spotify skips when CLIENT_SECRET absent)
  
**Celebrity Tracking:**
- Currently monitoring 15 high-profile celebrities across categories (Music, Sports, Politics, Tech, Entertainment)
- Celebrity list optimized for performance (60 API calls per refresh: 15 celebrities × 4 APIs)
- Rate limiting: 100ms delay between celebrity aggregations

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
- **Data Visualization**: Recharts (configured but not yet implemented for trend charts)
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