# AuthoriDex — Environment Variables

## Overview

AuthoriDex uses environment variables for all secrets and configuration. These must never be committed to GitHub.

- **Local dev:** stored in `.env` file in project root (gitignored)
- **Railway (backend):** set in Railway → Service → Variables
- **Vercel (frontend):** set in Vercel → Project → Settings → Environment Variables

---

## Required Variables

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string (Supabase session pooler, port 5432) |

**Important:** Use the **Session Pooler** URL from Supabase, not the direct connection.
Format: `postgresql://postgres.[ref]:[password]@aws-1-eu-north-1.pooler.supabase.com:5432/postgres`

---

### Supabase

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL (https://xxx.supabase.co) |
| `SUPABASE_ANON_KEY` | ✅ Yes | Public anon key (safe for frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes in production | Private service role key for backend admin/storage operations (backend only — never expose to frontend) |

---

### External APIs (Ingestion Engine)

| Variable | Required | Where to get |
|---|---|---|
| `SERPER_API_KEY` | ✅ For ingestion | serper.dev |
| `MEDIASTACK_API_KEY` | ✅ For ingestion | mediastack.com |

**Note:** Wiki and GDELT do not require API keys.

**Local dev:** These are optional locally. Without them, ingestion will fail gracefully and use cached data. The UI still works fully.

---

### Application

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | ✅ Yes | Random string used to sign session cookies |
| `NODE_ENV` | Auto-set | Set by `cross-env` in npm scripts (development/production) |

---

## Runtime Notes

- The backend now fails fast if `SUPABASE_URL` is missing.
- Production also fails fast if `SUPABASE_SERVICE_ROLE_KEY` is missing.
- Outside production, the backend can fall back to `SUPABASE_ANON_KEY`, but some admin/storage flows may not work.
- Runtime auth uses Supabase sessions/JWTs, while profile state, roles, XP, and credits live in the `profiles` table.

---

### Optional / Future

| Variable | Required | Description |
|---|---|---|
| `DISABLE_SCHEDULERS` | ❌ Optional | Set to `true` to prevent schedulers from starting locally |
| `OPENAI_API_KEY` | ❌ Future | For AI-powered features |

---

## Environment Parity Checklist

Before deploying, confirm these variables exist in all three environments:

| Variable | Local `.env` | Railway | Vercel |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | ❌ not needed |
| `SUPABASE_URL` | ✅ | ✅ | ✅ if used client-side |
| `SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ if used client-side |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ❌ never |
| `SERPER_API_KEY` | ❌ optional | ✅ | ❌ not needed |
| `MEDIASTACK_API_KEY` | ❌ optional | ✅ | ❌ not needed |
| `SESSION_SECRET` | ✅ | ✅ | ❌ not needed |

---

## Security Rules

- **Never commit `.env` to GitHub** — confirm `.env` is in `.gitignore`
- **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend** — backend only
- **Never expose `SERPER_API_KEY` or `MEDIASTACK_API_KEY` to the frontend**
- Rotate keys immediately if accidentally committed

---

## Local .env Template

Copy this and fill in your values:

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-1-eu-north-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SESSION_SECRET=any-long-random-string-here
DISABLE_SCHEDULERS=true
```

---

## Where To Find Each Key

| Key | Location |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → Session Pooler |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `SERPER_API_KEY` | serper.dev → Dashboard → API Key |
| `MEDIASTACK_API_KEY` | mediastack.com → Dashboard → API Key |
| `SESSION_SECRET` | Generate any random string (50+ chars recommended) |

---

## Schema Workflow

### Recommended: migration files (safe, reviewable)

```bash
# 1. Edit shared/schema.ts
# 2. Generate a migration SQL file from the diff:
npm run db:generate
# 3. Review the SQL in migrations/XXXX_*.sql
# 4. Apply pending migrations to the database:
npm run db:migrate
```

### First-time setup on an existing database

If the database already has all tables (e.g. production Supabase), run the baseline script once to tell Drizzle the initial migration is already applied:

```bash
npm run db:baseline
```

After that, `npm run db:migrate` will only apply new migrations.

### Legacy: direct push (interactive)

```bash
npm run db:push
```

- Wraps `drizzle-kit push` with the project `.env` and auto-selects the non-destructive default if Drizzle prompts about truncation.
- `npm run db:push:raw` is available only for manual debugging when you explicitly want raw Drizzle behavior.
- The app expects `xp_ledger.user_id` and `credit_ledger.user_id` to align with `profiles.id`, not the legacy `users.id`.
