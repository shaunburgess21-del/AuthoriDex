# AuthoriDex — Project Context

> **This file is the single source of truth for AI agents working on this project.**
> At the end of every Cursor Agent session, update this file with what was built, changed, or decided.

---

## Project Overview

AuthoriDex is a fame/popularity trend tracking app. It tracks public figures' trending status using a trend score engine, AI-powered summaries, polling features, and real-time data ingestion.

**Founders:** Andrew & Shaun

---

## Tech Stack

| Layer | Technology | Host |
|-------|-----------|------|
| Frontend | (Verify framework — React/Next.js) | Vercel |
| Backend / Trend Score Engine | (Verify language/framework) | Railway |
| Database | PostgreSQL | Supabase |
| AI Summaries | OpenAI API (model: `gpt-4o`) | — |
| Auth | Supabase Auth (verify) | — |
| Repo | GitHub (shared between Andrew & Shaun) | — |
| Dev Environment | Cursor Pro + Claude Code | Local |

---

## Architecture

```
[Vercel Frontend] <--API--> [Railway Backend]
                                  |
                                  ├── Trend Score Engine (scheduled ingestion runs)
                                  ├── AI Summary Generation (OpenAI gpt-4o)
                                  └── Supabase PostgreSQL (profiles, scores, polls, etc.)
```

### Key Flows
- **Ingestion Runs:** Backend runs scheduled jobs to pull data from sources, compute trend scores, and store results in Supabase.
- **Trend Scores:** Calculated via the trend score engine on Railway. Freshness/health endpoints exist for monitoring.
- **Polling:** Two types — Opinion Polls and Sentiment Polls. Large bank of pre-built polling content.
- **AI Summaries:** Generated via OpenAI gpt-4o for public figure profiles.

---

## Core Features

- [ ] Trend score tracking and display
- [ ] AI-powered profile summaries
- [ ] Opinion Polls
- [ ] Sentiment Polls
- [ ] Search and discovery
- [ ] (Add more as they're built)

---

## Key Files & Directories

> Update this section as the project evolves. List important files so new agent sessions know where to look.

```
/                         # Repo root
├── CONTEXT.md            # ← You are here
├── .cursorrules          # Persistent Cursor Agent instructions (TODO: create)
├── .gitignore            # Hardened — blocks .env, service keys
├── (list key dirs/files as they become clear)
```

---

## Environment & Secrets

- Supabase Service Role Key — rotated after accidental commit; now blocked by `.gitignore` and a pre-commit hook
- All secrets stored in environment variables on Railway (backend) and Vercel (frontend)
- **Never commit `.env` files or API keys to the repo**

---

## Recent Changes

> **Update this section at the end of every Cursor Agent session.**
> Format: `[DATE] — Brief description of what changed`

- [2026-03-07] — Created CONTEXT.md for cross-session context persistence

---

## Post-Launch Backlog

- Admin panel diagnostics: per-source success rate history, circuit breaker event log, API quota usage tracking

---

## Conventions & Decisions

- **Git workflow:** Andrew and Shaun collaborate via shared GitHub repo
- **AI model:** OpenAI `gpt-4o` (upgraded from `gpt-4o-mini`)
- **Security:** Pre-commit hook prevents accidental secret commits
- **MCP integrations:** Exploring Railway, Vercel, and GitHub MCPs in Cursor
- (Add architectural decisions, naming conventions, patterns as they're established)

---

## How to Use This File

1. **Starting a new Cursor Agent session?** Reference this file with `@CONTEXT.md` so the agent reads it.
2. **Finishing a session?** Prompt the agent: *"Update CONTEXT.md with what we just built/changed."*
3. **Both founders should keep this updated** — it's the shared memory between sessions and between Andrew and Shaun's workflows.
