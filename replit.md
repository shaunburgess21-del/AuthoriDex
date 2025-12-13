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

### Home Page (/)
The main dashboard displaying trending celebrities and influencers.

**Sections:**
1. **Hero Section** - Animated branding with call-to-action
2. **Trend Widgets** - Three cards showing Daily Movers, Weekly Gainers, Weekly Droppers
3. **Prediction Markets Teaser** - Carousel preview of Head-to-Head battles
   - Title: "Prediction Markets" with subtitle "Predict the next big move. Win reputation."
   - "View All Markets" button links to /predict
   - 3 featured battles: Musk vs Zuckerberg, Swift vs Beyoncé, Drake vs Kendrick
   - Uses react-slick carousel (3 desktop, 2 tablet, 1 mobile with center mode)
   - Purple glow hover effect on cards
4. **Leaderboard** - Filterable/sortable list of all trending people

### Vote Page (/vote)
The Vote page is styled as a "Community Town Hall" with cyan/teal accent theme for community governance features.

**Hero Section:**
- Title: "Shape the FameDex"
- Subtitle: "Vote on new inductees, curate profile images, and rate global sentiment."
- Badge: "Community Governance" with Sparkles icon
- Stats bar: Total Votes Cast (formatted number), Next Induction In (countdown timer)
- Cyan gradient background overlay

**Section 1: The Induction Queue (Carousel)**
- InductionCard components for voting new celebrities onto the leaderboard
- Each card shows: PersonAvatar (lg), name, category badge, progress bar (votes/1000)
- "Vote to Induct (+1)" button changes to "Voted!" when clicked (disabled state)
- Confetti animation on vote (ping animations)
- Candidates: Jensen Huang, Charli XCX, Kai Cenat, Sabrina Carpenter, xQc

**Section 2: Paparazzi Pit (Carousel)**
- ImagePollCard components for A/B photo voting
- Each card shows: person name, category badge, two photo options (A/B)
- After voting, shows percentage preference for selected photo
- Selected photo gets cyan border/ring highlight
- Polls: Taylor Swift, Elon Musk, Beyoncé, MrBeast

**Section 3: Global Sentiment Pulse (Carousel)**
- SentimentCard components for quick 1-10 ratings
- Each card shows: PersonAvatar (md), name, category, rating slider (1-10)
- "Submit Rating" button, after submission shows "Your vote recorded!" and global average
- Color-coded ratings (red → orange → yellow → lime → green)
- People: Elon Musk, Taylor Swift, MrBeast, Donald Trump, Kim Kardashian, Cristiano Ronaldo

**Floating Action Button:**
- Fixed position bottom-right (bottom-24 on mobile for nav clearance, bottom-8 on desktop)
- Opens "Suggest a Candidate" dialog with name input and category select
- Categories: Music, Tech, Entertainment, Sports, Politics, Business
- Submit button disabled until both fields are filled

**Navigation:**
- Desktop: Header with Home, Vote, Predict, Me links (Vote highlighted in cyan)
- Mobile: Back button in header, fixed bottom nav

**Technical Details:**
- All sections use react-slick carousels (3 slides desktop, 2 tablet, 1 mobile with center mode)
- Cyan/teal theme: text-cyan-400, bg-cyan-500, border-cyan-500/40
- Hover effects: translate-y-[-2px] with shadow and border highlight
- All interactive elements have data-testid attributes

### Predict Page (/predict)
Parimutuel prediction markets with test mode (virtual 10,000 credits):

**First-Time Visitor Experience:**
- Onboarding modal on first visit (localStorage key: `famedex_predict_first_visit`)
- Explains parimutuel system in 3 steps: Pick a Market, Back Your Prediction, Win from the Pool
- "How it works" link in hero reopens the modal

**Hero Section:**
- Gradient background with FameDex branding
- Status bar showing: TEST MODE badge, current balance, active predictions count
- "How it works" link to open onboarding modal

**Market Sections (Horizontal Carousels using react-slick):**
1. **Weekly Up/Down Markets** - Predict if a person's score will go up or down
   - Shows current score, 7-day change, pool split visualization
   - Dynamic multipliers (e.g., "Up 1.7x", "Down 2.3x")
   - Green Up button, Red Down button
2. **Head-to-Head Battles** - Pick who will gain more this week
   - VS format with two person avatars
   - Pool split bar showing betting percentages
   - Category badges (Music, Tech, Sports)
3. **Category Races** - Predict top gainer in a category
   - Shows top 3 contenders with ranking badges
   - Time remaining countdown
4. **Top Gainer Predictions** - Leaderboard-style predictions
   - Shows current leaders with point gains
   - Category-based grouping

**ViewAllModal:**
- Accessible via "View All" button on each carousel section
- Full-screen modal with search functionality
- Grid display of all cards in that category

**Technical Details:**
- Carousel: react-slick with responsive breakpoints (3 slides desktop, 2 tablet, 1 mobile)
- Pool display on every card with "Pool: X credits" format
- Hover effects: translate-y-[-2px] with shadow and border highlight
- Cards maintain square avatars with rounded corners (PersonAvatar component)

### Me Page (/me)
User profile showing votes and favorites (placeholder for Supabase auth integration).