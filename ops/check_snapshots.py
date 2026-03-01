#!/usr/bin/env python3
"""
AuthoriDex — Snapshot Freshness Check
Verifies trend_snapshots are being written on schedule.
Run: python ops/check_snapshots.py
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

FRESHNESS_URL = os.environ.get(
    "AUTHORIDEX_API_URL",
    "https://authoridex-production.up.railway.app"
) + "/api/system/freshness"

def main():
    result = {
        "status": "ok",
        "summary": "",
        "details": [],
        "action_items": []
    }

    try:
        req = urllib.request.Request(FRESHNESS_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        system_status = data.get("systemStatus", "unknown")
        full_refresh = data.get("fullRefreshAtFormatted", "unknown")
        live_updated = data.get("liveUpdatedAtFormatted", "unknown")
        full_refresh_at = data.get("fullRefreshAt")

        result["details"].append(f"System status: {system_status}")
        result["details"].append(f"Last full refresh: {full_refresh}")
        result["details"].append(f"Last live tick: {live_updated}")

        # Check if last ingestion is stale (>2 hours)
        if full_refresh_at:
            last = datetime.fromisoformat(full_refresh_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            age_hours = (now - last).total_seconds() / 3600

            if age_hours > 2:
                result["status"] = "warning"
                result["action_items"].append(
                    f"Last snapshot is {age_hours:.1f}h old — ingestion may be delayed"
                )
            elif age_hours > 4:
                result["status"] = "error"
                result["action_items"].append(
                    f"Last snapshot is {age_hours:.1f}h old — ingestion appears broken"
                )

        if system_status == "healthy":
            result["summary"] = f"Snapshots healthy — last refresh {full_refresh}"
        else:
            result["status"] = "warning"
            result["summary"] = f"System status: {system_status} — last refresh {full_refresh}"
            result["action_items"].append(f"System reporting status: {system_status}")

        # Check sources
        sources = data.get("sources", {})
        for source, info in sources.items():
            if isinstance(info, dict):
                src_status = info.get("status", "unknown")
                if src_status not in ("live", "healthy", "cached"):
                    result["status"] = "warning"
                    result["details"].append(f"Source {source}: {src_status}")
                    result["action_items"].append(f"Source {source} is {src_status}")
                else:
                    result["details"].append(f"Source {source}: {src_status} ✓")

    except urllib.error.URLError as e:
        result["status"] = "error"
        result["summary"] = f"Cannot reach production API: {e}"
        result["action_items"].append("Production API unreachable — check Railway deployment")
    except Exception as e:
        result["status"] = "error"
        result["summary"] = f"Check failed: {e}"
        result["action_items"].append(f"Unexpected error: {e}")

    if not result["summary"]:
        result["summary"] = f"Status: {result['status']}"

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
