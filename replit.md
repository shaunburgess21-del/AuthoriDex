# TrendSurge - Real-Time Fame Tracking Platform

## Overview

TrendSurge is a real-time celebrity and influencer tracking platform that monitors trending people worldwide. The application displays live trending data with rankings, trend scores, and percentage changes over 24-hour and 7-day periods. Users can search, filter by category, and sort trending individuals while viewing detailed analytics for each person.

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
- Mock data generation system in `/server/lunarcrush.ts` (placeholder for real API integration)

**Key Design Decisions:**
- **Data Layer**: Abstracted storage interface (`IStorage`) allowing swappable implementations (in-memory vs. database)
- **Middleware Pattern**: Request logging, JSON parsing, and error handling implemented as Express middleware
- **Development Mode**: Vite integration in development for HMR; static file serving in production
- **API Integration**: Structured for future LunarCrush API integration with fallback to mock data

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

**Third-Party Services:**
- **LunarCrush API**: Planned integration for real-time trending data (currently using mock data)
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