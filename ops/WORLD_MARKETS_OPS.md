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
- Seed values (`seedCount`) are display-only; they do not affect parimutuel payout math
- Settlement is manual via admin (`resolveMethod: "admin_manual"`)
- The `closeAt` field defaults to `endAt` but can be adjusted per-market in the edit modal
- Linked persons are resolved by name against `tracked_people`; if not found, the market is created without a link (with a warning)
- Secondary person names (e.g., "Joe Rogan / Donald Trump") are stored in `metadata.secondaryPerson`
