# Admin: Add Celebrity — ingest and leaderboard behavior

## What happens when you click “Add Celebrity”

1. **API:** `POST /api/admin/celebrities` inserts one row into `tracked_people` (name, category, status, `image_slug`, optional wiki / X / search override) and writes an **admin audit log** entry.
2. **No dedicated queue row:** Ingestion is **not** triggered by this request. The hourly (or scheduled) **ingest job** reads **all** rows from `tracked_people` and includes Sigurd/Serper/search/wiki flows for each person.
3. **Public main leaderboard (`trending_people`):** Rows are **upserted at the end of a successful ingest**, not at admin-save time. Expect the new celebrity to appear after the **next successful ingest** that completes for a new UTC hour bucket.

## Timing and idempotency

- Ingest skips work if a **completed** run already exists for the same `hour_bucket` + `score_version`. Adding someone **after** that run finished does not backfill that hour; they are picked up on the **next** run.
- If ingest aborts (e.g. safety checks on average `fameIndex`), **`trending_people` is not updated** for that run for anyone.

## Images

- Optional gallery uploads from the Add Celebrity modal use the same path as Curate Profile: Supabase bucket `public-images`, path `curate-profile/{personId}/…`, rows in `celebrity_images`.
- The **first** image for a person is marked primary and updates `tracked_people.avatar` (and `trending_people.avatar` if that row exists).

## Related tables

- **`celebrity_metrics`:** A row is created on admin celebrity create (with defaults) so features that join this table do not miss the new person.

## Operational checklist

- Confirm `name` is unique (`tracked_people.name` is unique).
- After add: verify `tracked_people` row, optional `celebrity_images`, then after ingest: `trend_snapshots` / `trending_people`.
