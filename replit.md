# FameDex - Real-Time Fame Tracking Platform

## Overview

FameDex is a real-time celebrity and influencer tracking platform designed to monitor trending individuals globally. It aggregates data from multiple authoritative sources to display live trending data, including rankings, unified trend scores, and percentage changes over 24-hour and 7-day periods. Users can search, filter by category, sort trending individuals, and access detailed analytics for each person. The platform's vision is to become a leading tool for tracking and analyzing global fame, drawing inspiration from financial tracking and social trending interfaces.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- **Core**: React 18 with TypeScript, Vite, Wouter (routing), TanStack Query (server state), Tailwind CSS
- **UI Components**: Radix UI (primitives), shadcn/ui (New York style variant)
- **Styling**: Custom theme system with dark/light modes, HSL color tokens, responsive design (mobile-first)

**Key Design Decisions:**
- **Component Architecture**: Atomic design pattern, reusable UI components, feature-specific trending data visualization.
- **State Management**: React Query for server state (5-minute refetch), React hooks for local UI state.
- **Routing**: File-based route components using Wouter.
- **Styling**: Design tokens via CSS variables, custom utility classes for effects.
- **Expandable Rows**: LeaderboardRow with inline expansion using AnimatePresence/Framer Motion, custom event system for sentiment score synchronization, dynamic color-coding based on sentiment.
- **Visuals**: Square avatars with rounded corners, supporting custom hero images and initials fallback.

### Backend Architecture

**Technology Stack:**
- **Core**: Node.js with Express.js, TypeScript, Drizzle ORM
- **Database**: In-memory storage (current), planned PostgreSQL support

**API Design:**
- **Architecture**: RESTful endpoints, query parameter support for filtering/sorting, separation of concerns.
- **Data Aggregation**: Multi-source API aggregation system (currently mock data driven).

**Mock Data System (Currently Active):**
- **Purpose**: Facilitate design/UX iteration without API constraints.
- **Data Generation**: Realistic trend scores (100k-500k), 30 days of historical data, platform-specific insights (X, YouTube, Instagram, TikTok, Spotify, News) with mock follower counts.
- **Sentiment Voting**:
    - Animated segmented design (Figma match) with 10 segments (`#FF0000` to `#00C853`).
    - Progressive fill effect, line-style needle (centered), zone labels (Hate, Dislike, Neutral, Like, Love), number labels (1-10).
    - Accessibility: Full keyboard navigation, ARIA attributes, screen reader support.
    - Two-mode toggle: "Cast Your Vote" (interactive slider) and "View Results" (vertical bar graph with average rating and community sentiment).
    - Placement: Between stats cards and Trend History chart.
- **Performance**: 30-second cache for development, optimized generation times.

**Real API Integration Architecture (Future):**
- Data Aggregation: Combines data from external APIs (News, YouTube, Spotify, SERP) into unified scores.
- Balanced Scoring Algorithm: Metrics normalized and weighted (news 30%, YouTube 25%, Spotify 25%, search trends 20%), scaled to 100k-500k.

### Data Storage Solutions

**Current Implementation:**
- In-memory storage using Map data structures for development.

**Database Schema (PostgreSQL with Drizzle ORM - Planned):**
- `users`: Authentication (id, username, password).
- `trending_people`: Person data (id, name, avatar, rank, trendScore, change24h, change7d, category).
- UUID primary keys, type-safe schema definitions.
- Migration Strategy: Drizzle Kit configured for PostgreSQL.

## External Dependencies

**Third-Party API Services:**
- **News API**: For news mentions.
- **YouTube Data API**: For video views and popularity.
- **Spotify Web API**: For artist follower counts.
- **SERP API (Google Trends)**: For search interest trends.
- **Google Fonts**: Inter, Space Grotesk, JetBrains Mono.
- **Neon Database**: PostgreSQL provider via `@neondatabase/serverless`.

**Key Libraries:**
- **UI Components**: Radix UI.
- **Form Handling**: React Hook Form with Zod validation.
- **Data Visualization**: Recharts.
- **Date Utilities**: date-fns.
- **Session Management**: connect-pg-simple (for PostgreSQL-backed sessions).

**Development Tools:**
- Replit-specific plugins.
- ESBuild (production bundling).
- PostCSS with Autoprefixer.

## Page Structure

### Vote Page (/vote)
The Vote page provides three distinct voting mechanisms for community engagement:

**Header Section:**
- Title: "Vote on Global Influence"
- 3-step explainer cards (Pick a vote type → Cast your vote → See your impact)

**Section 1: Sentiment Votes**
- Unified row-based list: All people shown as clickable rows (no inline slider)
- First person (Elon Musk) has "Featured" badge
- Shows top 5 people by default, "View all X people to rate" toggle expands to full list
- Clicking any row OR Vote button opens the same sentiment modal
- Modal includes:
  - Person avatar and "Rate {name}" title
  - SentimentVotingWidget (same component as profile pages)
  - "Visit full profile" link at bottom to navigate to person's profile
- Votes persist to localStorage with key pattern `vote_${personId}`
- Modal auto-closes 1.5 seconds after vote submission

**Section 2: Profile Image Voting**
- 3 featured cards shown by default (Taylor Swift, MrBeast, Beyoncé)
- "View all profile image votes" toggle shows 5 additional cards
- Each card has 3 image options with vote percentages

**Section 3: Suggest New People**
- Cards for suggested additions (Jensen Huang, Charli XCX, Kai Cenat, Lionel Messi)
- Green upvote button, red downvote button
- Mutual exclusivity: selecting one deselects the other (no unvote)

**Navigation:**
- Desktop: Header with Home, Vote, Predict, Me links
- Mobile: Fixed bottom nav with Heart icon for Vote

### Predict Page (/predict)
Prediction markets with test mode (virtual 10,000 credits):
- Weekly Up/Down markets
- Head-to-Head Battles
- Category Races

### Me Page (/me)
User profile showing votes and favorites (placeholder for Supabase auth integration).