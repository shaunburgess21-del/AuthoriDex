# World Markets -- Operational Guide

## Import Workflow

### Prerequisites

1. Server must be running (locally or on Railway)
2. You need an admin session token (`ADMIN_TOKEN`)
3. The spreadsheet lives at `ops/authoridex_world_markets_launch_top25_final.xlsx`

### Step 1: Archive existing placeholders

Before importing, archive any placeholder World Markets currently in the system:

1. Go to **Admin > Predictions > World Markets**
2. Set the **Visibility** filter to "Live"
3. Check **Select all**
4. Click **Archive [N]**

Or via API:
```bash
curl -X POST http://localhost:5000/api/admin/open-markets/batch-visibility \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"marketIds": ["id1", "id2", ...], "visibility": "archived"}'
```

### Step 2: Dry run

Validate the spreadsheet without inserting anything:

```bash
ADMIN_TOKEN=your_token npx tsx ops/import-world-markets.ts --dry-run
```

Review the output for:
- **ERROR**: Must fix before real import (missing fields, duplicate slugs, etc.)
- **WARNING**: Non-blocking but worth noting (person not in tracked people, non-standard category)
- **INFO**: Informational (secondary person stored in metadata, etc.)

### Step 3: Real import

```bash
ADMIN_TOKEN=your_token npx tsx ops/import-world-markets.ts
```

All 25 markets will be created with `visibility: "draft"` and `status: "OPEN"`.

### Step 4: Review in admin

1. Go to **Admin > Predictions > World Markets**
2. Set the **Visibility** filter to "Draft"
3. Review each market: title, category, entries, resolution date, linked person
4. Edit any market that needs adjustments (the edit modal now correctly loads entries)

### Step 5: Batch publish launch wave

1. Filter by "Draft" visibility
2. Select the 18 wave-1 markets (ranks 1-18)
3. Click **Publish [18]**
4. Wave-2 markets (ranks 19-25) stay as drafts until the first refresh cycle

### Step 6: Add cover images

Images were not included in this import. For each market:
1. Click the **Edit** (pencil) button
2. Upload or paste the cover image URL
3. Save

---

## Weekly Monday Ritual

1. **Resolve due markets**: Filter by "Overdue" badge or sort by resolution date. Settle any CLOSED_PENDING markets from last week.
2. **Review closing-soon**: Check markets with the "Resolves soon" badge. Confirm resolution sources are ready.
3. **Add new markets**: Create 3-5 fresh candidates from leaderboard movers using the Create button.
4. **Retire stale markets**: Archive or void any low-engagement markets.
5. **Promote wave-2**: If wave-1 is healthy, publish some wave-2 drafts.

---

## API Reference

### Import markets
```
POST /api/admin/open-markets/import?dryRun=true|false
Body: { "markets": [...] }
```

Each market object:
```json
{
  "title": "Will OpenAI release GPT-5 before 30 Jun 2026?",
  "slug": "openai-gpt5-jun-2026",
  "type": "binary",
  "teaser": "Is the next AI leap just months away?",
  "category": "tech",
  "linkedPerson": "Sam Altman",
  "resolutionDate": "2026-06-30T00:00:00.000Z",
  "resolutionCriteria": "OpenAI officially releases GPT-5...",
  "entries": [
    { "label": "Yes", "seedCount": 120 },
    { "label": "No", "seedCount": 40 }
  ],
  "closeAt": null
}
```

Up/Down markets also need: `underlying`, `metric`, `strike`, `unit`.

### Batch visibility
```
POST /api/admin/open-markets/batch-visibility
Body: { "marketIds": ["id1", "id2"], "visibility": "live" }
```

### Admin detail (with entries)
```
GET /api/admin/open-markets/:id
```

---

## Future Spreadsheet Imports

To import a new batch of markets later:

1. Create a new XLSX with the same column headers as `Import_Top_25`
2. Place it in `ops/`
3. Run: `ADMIN_TOKEN=token npx tsx ops/import-world-markets.ts --file ops/new-batch.xlsx --dry-run`
4. Review, then run without `--dry-run`

The importer accepts both the structured `entries` array format and the flat `Option 1`/`Seed 1` column format from the spreadsheet.

---

## Architecture Notes

- All imported markets use `marketType: "community"` and `visibility: "draft"`
- Imported markets are AMM (LMSR) post-parimutuel-sunset; the importer
  calls `seedAmmMarket` right after the row insert
- Seed values (`seedCount`) are display-only; they do not affect AMM
  pricing (AMM prices are driven by `marketAmmState.shareQuantities`)
- Settlement is manual via admin (`resolveMethod: "admin_manual"`) →
  routes to `resolveAmmMarket` with a chosen winner entry
- The `closeAt` field defaults to `endAt` but can be adjusted per-market in the edit modal
- Linked persons are resolved by name against `tracked_people`; if not found, the market is created without a link (with a warning)
- Secondary person names (e.g., "Joe Rogan / Donald Trump") are stored in `metadata.secondaryPerson`

---

## Emergency Recovery (post-sunset wipe)

The parimutuel sunset wipe (`scripts/sunset-wipe-parimutuel.ts`) deletes
every non-jackpot row where `engine='parimutuel'`. Community markets had
`engine='parimutuel'` at that moment and were caught by the predicate.
If you ever need to redo the wipe in the future, **carve out
`market_type='community'` first** (flip them to AMM and seed) or accept
that the curated launch wave will be lost.

### ops/restore-house-wallet.ts

`scripts/sunset-reset-credits.ts` had a bug — it treated the
`__house__` profile as a regular human and reset its balance to
`SIGNUP_CREDIT_GRANT` (10,000). After two market seeds (~5k each) the
house ran dry and `seedAmmMarket` started throwing "insufficient
credits". This blocked every new AMM market creation (community
imports, weekly h2h/updown/gainer regeneration, admin-created
markets).

Restore the house to its design baseline (1B virtual credits per
migration 0052):

```bash
npx tsx ops/restore-house-wallet.ts --dry-run
npx tsx ops/restore-house-wallet.ts
npx tsx ops/restore-house-wallet.ts --target 500000000   # alternative
```

Writes a `credit_ledger` audit row with `txn_type='house_restore'`.
Idempotent: no-op if the house is already at (or above) the target.

The bug in `scripts/sunset-reset-credits.ts` was patched at the same
time to skip `is_house=true` profiles, so a future re-run of the
sunset script won't recreate this problem.

### ops/restore-world-markets.ts

Direct-DB version of the admin import route. Re-imports community
markets from the curated XLSX (`authoridex_world_markets_launch_top25_final.xlsx`)
without needing a running server or admin token.

```bash
# Defaults: looks for the xlsx in ops/, then ~/Downloads/
npx tsx ops/restore-world-markets.ts --dry-run
npx tsx ops/restore-world-markets.ts

# Or specify the file
npx tsx ops/restore-world-markets.ts \
  --file "C:/Users/you/Downloads/authoridex_world_markets_launch_top25_final.xlsx"

# Past resolution dates get auto-bumped by N days (default 30)
npx tsx ops/restore-world-markets.ts --bump-past-days 45
npx tsx ops/restore-world-markets.ts --bump-past-days 0   # skip past-dated rows instead
```

Created markets are `engine='amm'`, `visibility='draft'`, `status='OPEN'`,
AMM-seeded inside the same transaction as the row insert. The script
applies accent-folding + whitespace-collapse when resolving linked
persons (so "Kylian Mbappé" in the xlsx matches "Kylian Mbappe" in
`tracked_people`).

Pre-reqs:
1. `DATABASE_URL` set in `.env` (script auto-loads via `process.loadEnvFile`).
2. House wallet has enough virtual credits to seed every new market
   (~5,000 per market by default). Run `restore-house-wallet.ts` first
   if you've recently run the sunset reset.

After import, the 25 markets land in **Admin > Predictions > World
Markets > Draft filter**. Review titles, dates and entries, add cover
images, then bulk-publish via the "Publish [N]" button (or the
`/api/admin/open-markets/batch-visibility` route).
