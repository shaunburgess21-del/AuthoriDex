# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

VoxDex is a monorepo with a **single Express server** that serves both the REST API and the Vite-built React SPA in middleware mode. Everything runs on one port (default 5000). There is no separate frontend dev server.

### Key commands

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (Express + Vite on port 5000) |
| Type check | `npm run check` (runs `tsc`) |
| Tests | `npm test` (Node.js built-in test runner, 272 tests) |
| DB schema push | `DATABASE_URL=... npx drizzle-kit push --force` |
| Build | `npm run build` |

### Local PostgreSQL setup

The cloud VM uses a local PostgreSQL 16 instance (not Supabase). Start it with:
```
sudo pg_ctlcluster 16 main start
```
Database: `voxdex`, user: `voxdex`, password: `voxdex_dev_pw` on `localhost:5432`.

### Environment variables (.env)

A `.env` file must exist in the workspace root. Critical entries:
- `DATABASE_URL=postgresql://voxdex:voxdex_dev_pw@localhost:5432/voxdex`
- `SUPABASE_URL=http://localhost:54321` (placeholder; auth features won't work without real creds)
- `SUPABASE_ANON_KEY=placeholder-anon-key`
- `SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-key`
- `OPENAI_API_KEY=sk-placeholder-not-a-real-key` (required to prevent crash at module load from `server/agents/worldMarketEngine.ts`)
- `DISABLE_SCHEDULERS=true` (prevents background ingestion jobs from running)
- `LOG_PRETTY=true` (human-readable log output)

### Gotchas

1. **OpenAI key required at boot**: The `server/agents/worldMarketEngine.ts` file instantiates `new OpenAI()` at module load time. Without any `OPENAI_API_KEY` (even a dummy), the server crashes immediately. The LLM features are disabled by `WORLD_MARKETS_LLM_ENABLED=false`, so a placeholder key is fine.

2. **SSL with local PostgreSQL**: The `server/db.ts` always passes `ssl: { rejectUnauthorized: false }` to the pg pool. This works fine with local PostgreSQL 16 on Ubuntu (SSL is enabled by default with self-signed certs).

3. **Empty database is fine**: The app boots cleanly with an empty database. The leaderboard and trending pages show empty states. Categories are seeded via schema push.

4. **Schedulers warning**: On boot you'll see `[Schedulers] FATAL MISCONFIG — DISABLE_SCHEDULERS=true but no CRON_SECRET is set`. This is safe to ignore in local dev — it just means no background ingestion jobs run.

5. **No separate frontend build step needed for dev**: Vite runs in middleware mode inside Express, so `npm run dev` handles everything.

6. **Anonymous voting works without Supabase auth**: Endpoints like `/api/celebrity/:id/value-vote` and `/api/matchups/:id/vote` support anonymous voting via session cookie (`fdx_sid`). This allows testing core voting flows without real Supabase credentials. To test, insert a person into `trending_people` and POST with `{"vote": "underrated"}`.

7. **Database schema push**: After `npm install`, push the schema with `DATABASE_URL=postgresql://voxdex:voxdex_dev_pw@localhost:5432/voxdex npx drizzle-kit push --force`.
