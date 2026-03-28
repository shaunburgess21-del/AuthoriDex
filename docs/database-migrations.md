# Database migrations (AuthoriDex / VoxDex)

## Reality on some environments

Some databases were created or evolved using **`drizzle-kit push`** and ad-hoc SQL instead of a continuous **`drizzle-kit migrate`** history. In those cases:

- There may be **no** `drizzle.__drizzle_migrations` journal table.
- Running **`npm run db:migrate`** from scratch can **fail** (e.g. enum/type already exists) because the DB is not an empty slate.

That does **not** mean you should skip schema alignment. It means you need a **defensive, additive** workflow.

## Safest ongoing approach

1. **Treat `shared/schema.ts` as the source of truth** for what the application expects.
2. When you add columns or tables, **generate SQL** with `npm run db:generate` and commit the new files under `migrations/`.
3. **Apply additive SQL** in each environment using one of:
   - **Neon / hosting SQL editor** — run the new `migrations/000X_*.sql` statements manually for that release, or
   - **Idempotent scripts** shipped in this repo (see below), or
   - **`psql`** / admin client with the same `DATABASE_URL` as production.

4. **Avoid** `drizzle-kit migrate` on “messy” legacy DBs unless you have reconciled the journal (baseline) with help from someone who knows the full history.

## Induction queue columns (`x_handle`, `induction_status`)

If `/api/vote/induction` returns 500 with `column "x_handle" does not exist`, the app code is ahead of the database.

**Fix (idempotent, safe to re-run):**

```bash
npm run db:ensure-induction-cols
```

This runs `server/scripts/ensure-induction-candidate-columns.ts`, which uses `ADD COLUMN IF NOT EXISTS`.

**Then** import or run the app as usual:

```bash
npm run import:induction
```

The CSV import script calls the same ensure step automatically before processing rows.

## Recommended deploy order

1. Deploy application code.
2. Run **`npm run db:ensure-induction-cols`** (or your release pipeline equivalent) against the target `DATABASE_URL`.
3. Run one-off data jobs (e.g. **`npm run import:induction`**) if needed.
4. Restart the API so connection pools pick up a healthy state after network blips.

## When `db:push` is still useful

`npm run db:push` (see `scripts/db-push-safe.cjs`) can help **development** environments stay close to `shared/schema.ts`, but production should prefer **explicit, reviewable SQL** or idempotent ensure scripts so you never depend on interactive prompts or accidental destructive defaults.
