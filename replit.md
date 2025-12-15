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
- **VotingModal Architecture**: Centralized single-instance modal at HomePage level. LeaderboardRow and HeroSection trigger the modal via callbacks (onVoteClick, onCastVoteClick) instead of managing their own dialogs. Supports "Vote Next" cycling through the people list.
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
The Vote page is styled as a "Community Town Hall" with cyan/teal accent theme for community governance features. Focus on "Grinding," rapid-fire interactions, and gamification.

**Gamification Header (Sticky XP Bar):**
- Sticky bar below main header with gradient background
- Displays: Rank (Crown icon, "Citizen") | XP (Zap icon, starts at 120)
- XP increments on any vote action (+10 for Paparazzi/Induction, +20 for Discourse)
- Floating "+X XP" animation appears near cursor on vote, floats up and fades

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
- Confetti animation on vote (ping animations), triggers +10 XP
- Candidates: Jensen Huang, Charli XCX, Kai Cenat, Sabrina Carpenter, xQc

**Section 2: Curate the Profile (Hot or Not Rapid-Fire)**
- Renamed from "Paparazzi Pit" for clarity
- Single card at a time (not carousel), shows progress "X of Y"
- "Which look defines them?" headline
- Description: "Decide the official photo displayed across FameDex."
- Two large clickable photo placeholders (Look A / Look B)
- No submit button - clicking a photo:
  1. Green border flash on selected image
  2. Triggers +10 XP animation
  3. Auto-advances to next pair after 600ms delay
- "Start Over" button appears when all pairs completed

**Section 3: The People's Voice (Responsive CSS Grid)**
- Renamed from "Public Discourse"
- Subtitle: "You, The People, decide the narrative. Weigh in on the topics that matter."
- **Layout:** Responsive CSS Grid (NOT carousel)
  - Desktop: 3 columns (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
  - Tablet: 2 columns
  - Mobile: 1 column
  - Gap: `gap-5` (20px) to prevent overlap
- DiscourseCard components for voting on controversial topics/events
- Each card shows: category badge, headline, description, 3 equal-width neon buttons in a single row
- **Neon Ghost Buttons (Equal Width Symmetry):**
  - Oppose: Crimson Red (#FF003F) text/border, red neon glow on hover
  - Neutral: Ghost White (#F0F8FF) text/border, white glow on hover
  - Support: Neon Green (#39FF14) text/border, green neon glow on hover
  - All buttons: Dark background (black/30) with 1px border, equal flex: 1 width for symmetry
- After voting: Shows percentage bar (Disapprove % | Neutral % | Approve %) with total votes
- Triggers +20 XP on vote
- Mock Topics: "Elon buys Twitter", "AI replacing jobs", "Taylor's Eras Tour pricing"

**Floating Action Button:**
- Fixed position bottom-right (bottom-24 on mobile for nav clearance, bottom-8 on desktop)
- Opens "Suggest a Candidate" dialog with autocomplete search
- **Celebrity Autocomplete:**
  - 30 mock celebrity names (Taylor Swift, Elon Musk, Keanu Reeves, etc.)
  - Filters suggestions as user types (min 1 character)
  - Shows up to 8 filtered results with PersonAvatar
  - Clicking suggestion auto-fills the input
- Categories: Music, Tech, Entertainment, Sports, Politics, Business
- Submit button disabled until both fields are filled

**Navigation:**
- Desktop: Header with Home, Vote, Predict, Me links (Vote highlighted in cyan)
- Mobile: Back button in header, fixed bottom nav

**Technical Details:**
- XP state managed locally in React (mock data, no backend)
- Framer Motion for XP floater animations
- Cyan/teal theme: text-cyan-400, bg-cyan-500, border-cyan-500/40
- All interactive elements have data-testid attributes

### Predict Page (/predict)
Parimutuel prediction markets with test mode (virtual 10,000 credits). Styled with **Royal Purple theme** (violet/fuchsia accents).

**First-Time Visitor Experience:**
- Onboarding modal on first visit (localStorage key: `famedex_predict_first_visit`)
- Explains parimutuel system in 3 steps: Pick a Market, Back Your Prediction, Win from the Pool
- "How it works" link in hero reopens the modal
- Modal uses violet-500 accent colors for icons and highlighted text

**Hero Section:**
- Violet gradient background (`from-violet-500/20 via-violet-500/10 to-transparent`)
- Purple Zap icon (`text-violet-500`)
- Status bar showing: TEST MODE badge (violet themed), current balance with purple Wallet icon, active predictions count
- "How it works" link with `hover:text-violet-500`

**Market Sections (Horizontal Carousels using react-slick):**
1. **Weekly Up/Down Markets** - Predict if a person's score will go up or down
   - Shows current score, 7-day change, pool split visualization
   - Dynamic multipliers (e.g., "Up 1.7x", "Down 2.3x")
   - Green Up button, Red Down button (kept for financial clarity)
2. **Head-to-Head Battles** - Pick who will gain more this week
   - VS badge with violet theme (`bg-violet-500/10 text-violet-500`)
   - Pool text in violet-500
   - Pool split bar showing betting percentages
3. **Category Races** - Predict top gainer in a category
   - Ranking badges in violet-500
   - "Enter Race" button with purple gradient (`from-violet-600 to-fuchsia-600`)
   - Time remaining countdown
4. **Top Gainer Predictions** - Leaderboard-style predictions
   - Pool text in violet-500
   - "Place Prediction" button with purple gradient

**PredictCard Component:**
- Wrapper component providing gradient spotlight border effect
- Border: `from-violet-500/80 via-purple-500/30 to-transparent`
- Hover: `shadow-violet-500/20` purple glow effect
- Used by all prediction card types (Weekly, H2H, Category Race, Top Gainer)

**ViewAllModal:**
- Accessible via "View All" button (violet-500 text) on each carousel section
- Full-screen modal with search functionality (focus ring: violet-500/50)
- Grid display of all cards in that category

**Technical Details:**
- Royal Purple theme: violet-500, violet-600, fuchsia-600 accent colors
- Carousel: react-slick with responsive breakpoints (3 slides desktop, 2 tablet, 1 mobile)
- Carousel arrows styled in violet (rgb(139 92 246))
- Pool display on every card with "Pool: X credits" format in violet-500
- Hover effects: translate-y-[-2px] with purple shadow glow
- Cards maintain square avatars with rounded corners (PersonAvatar component)
- Nav link "Predict" highlighted in violet-500

### Me Page (/me)
User profile showing votes and favorites (placeholder for Supabase auth integration).