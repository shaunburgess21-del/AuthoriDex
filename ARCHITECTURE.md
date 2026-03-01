# AuthoriDex — Architecture Overview

## What Is AuthoriDex?

AuthoriDex is a live influence index and prediction platform. It measures, ranks, and gamifies real-world influence across Politics, Business, Tech, Sports, and Entertainment. Users vote, predict outcomes, and track influence momentum in real time.

---

## High-Level System Map

```
User Browser
     ↓
Vercel (Frontend - React/Vite)
     ↓
Railway (Backend - Node/Express API)
     ↓
Supabase (PostgreSQL Database)
     ↑
External APIs (Serper, Mediastack, Wiki, GDELT)
```

---

## Stack

| Layer | Technology | Host |
|---|---|---|
| Frontend | React 18, Vite, TailwindCSS, shadcn/ui | Vercel |
| Backend | Node.js, Express, TypeScript (tsx) | Railway |
| Database | PostgreSQL via Supabase | Supabase |
| ORM | Drizzle ORM | — |
| Session | express-session + connect-pg-simple | — |
| Auth | Passport.js (local strategy) | — |

---

## Folder Structure

```
AuthoriDex-main/
├── client/          # React frontend (Vite)
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Route-level pages
│   │   ├── hooks/        # Custom React hooks
│   │   └── lib/          # Utilities, API clients
├── server/          # Express backend
│   ├── index.ts          # Entry point, scheduler bootstrap
│   ├── db.ts             # Database connection (Drizzle + Supabase)
│   ├── routes.ts         # API route definitions
│   ├── auth.ts           # Authentication logic
│   ├── trending/         # Trend scoring engine
│   ├── ingestion/        # Data ingestion jobs
│   ├── jobs/             # Background schedulers
│   └── providers/        # External API integrations
├── shared/          # Shared types and schemas (frontend + backend)
├── public/          # Static assets
├── scripts/         # Utility/migration scripts
└── attached_assets/ # Dev reference images (not served in production)
```

---

## Core Features

### 1. Leaderboard (Influence Index)
- Dynamic ranking of 100 tracked public figures
- Ranked by composite score: votes + predictions + momentum + media activity
- Updates every hour (full ingestion) and every 10 minutes (live tick)

### 2. Matchups (Head-to-Head)
- Users vote on who wins head-to-head comparisons
- Example: Elon vs Zuckerberg, Trump vs Biden

### 3. Trending Polls (Support / Neutral / Oppose)
- Public sentiment polls on current topics
- Measures cultural direction in real time

### 4. Predictions (Real-World Outcomes)
- Users predict binary outcomes (Yes/No)
- Example: Will ETH hit $12k? Will OpenAI IPO?
- Accuracy tracked and feeds into user credibility score

### 5. Gamification
- Users earn XP and rank tiers (Citizen → Aspirant → etc.)
- Prediction accuracy increases signal weight over time

---

## Data Flow

```
External APIs (Serper/Mediastack/Wiki/GDELT)
     ↓ [Ingestion Job - hourly]
Raw signals collected per person
     ↓ [Score Engine]
Composite influence score calculated
     ↓ [trend_snapshots table]
Scores stored in Supabase
     ↓ [LiveTick - every 10 min]
Rankings recalculated
     ↓ [/api/leaderboard]
Frontend displays live rankings
```

---

## Key API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/leaderboard` | Returns ranked list of 100 people |
| `GET /api/trending` | Returns trending people/topics |
| `GET /api/matchups` | Returns active matchups |
| `GET /api/opinion-polls` | Returns sentiment polls |
| `GET /api/trending-polls` | Returns trending poll data |
| `GET /api/vote/induction` | Returns induction vote candidates |
| `GET /api/system/freshness` | Returns system health + scheduler status |

---

## Database (Supabase / PostgreSQL)

Key tables:

| Table | Purpose |
|---|---|
| `trending_people` | Master list of 100 tracked people |
| `trend_snapshots` | Hourly score snapshots per person |
| `matchups` | Head-to-head matchup definitions |
| `votes` | User votes on matchups |
| `predictions` | User predictions on outcomes |
| `opinion_polls` | Poll definitions |
| `poll_votes` | User responses to polls |
| `users` | User accounts |

---

## Environment Variables

See `ENV.md` for full details.

---

## Background Jobs

See `JOBS.md` for full details.

---

## Deployment

| Environment | Platform | Trigger |
|---|---|---|
| Production Frontend | Vercel | Auto-deploy on push to `main` |
| Production Backend | Railway | Auto-deploy on push to `main` |
| Local Dev | localhost:5000 | `npm run dev` |

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (loads .env automatically)
npm run dev

# App runs at http://localhost:5000
```

Requirements:
- Node.js v20+ (v24 recommended)
- `.env` file in project root with Supabase credentials
- See `ENV.md` for required variables

---

## Important Notes for AI Agents

- **Never modify `server/db.ts`** without understanding the Drizzle + Supabase pooler setup
- **Never push directly to `main`** — always use feature branches
- **Frontend and backend share types** via the `shared/` folder — changes there affect both
- **Scheduler logic lives in `server/index.ts`** bootstrap and `server/jobs/`
- **Score engine logic lives in `server/trending/`** — changes here affect all rankings
- The app uses **Wouter** for client-side routing (not React Router)
- The app uses **TanStack Query** for all data fetching on the frontend
