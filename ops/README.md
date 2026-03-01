# AuthoriDex — Ops Health Checks

Production observability scripts for the AuthoriDex trend score engine.

## Quick Start

```bash
# Full health check (run this every morning)
python ops/full_check.py

# Individual checks
python ops/check_snapshots.py
python ops/check_ingests.py
python ops/check_sources.py
python ops/check_frequencies.py
```

## Requirements

- Python 3.8+
- No additional packages needed (uses stdlib only)
- Internet access to reach production Railway API

## Scripts

| Script | What it checks |
|---|---|
| `full_check.py` | Runs all checks, produces unified report |
| `check_snapshots.py` | Snapshot freshness + system status |
| `check_ingests.py` | Ingestion schedule + API cap usage |
| `check_sources.py` | External API source health (Serper, Mediastack, Wiki, GDELT) |
| `check_frequencies.py` | Scheduler cadence (hourly ingest + 10-min LiveTick) |

## Using with Cursor Agent

In Cursor chat, type:
```
Run the full trend score health check and summarise the results
```

The agent will run `python ops/full_check.py`, read the output, and give you a conversational report with action items.

To investigate an issue:
```
The Mediastack source is in OUTAGE. Investigate the ingestion code and suggest a fix with fallback.
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AUTHORIDEX_API_URL` | `https://authoridex-production.up.railway.app` | Production API base URL |

Override if needed:
```bash
AUTHORIDEX_API_URL=https://your-url.railway.app python ops/full_check.py
```

## Status Levels

- `ok` — Everything nominal
- `warning` — Degraded but functional, monitor closely  
- `error` — Action required immediately

## Coming Next (Phase 2)

- Direct DB read-only connection for deeper snapshot analysis
- Per-person score drift detection
- Historical trend comparison
- Automated alert via email/Slack
