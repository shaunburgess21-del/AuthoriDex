#!/usr/bin/env python3
"""
AuthoriDex — Ingest Health Check
Checks ingestion status via the freshness API.
Run: python ops/check_ingests.py
"""

import json
import os
import urllib.request
from datetime import datetime, timezone

BASE_URL = os.environ.get(
    "AUTHORIDEX_API_URL",
    "https://authoridex-production.up.railway.app"
)

def main():
    result = {
        "status": "ok",
        "summary": "",
        "details": [],
        "action_items": []
    }

    try:
        url = BASE_URL + "/api/system/freshness"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        full_refresh_at = data.get("fullRefreshAt")
        full_refresh_formatted = data.get("fullRefreshAtFormatted", "unknown")
        result["details"].append(f"Last ingestion: {full_refresh_formatted}")

        if full_refresh_at:
            last = datetime.fromisoformat(full_refresh_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            age_hours = (now - last).total_seconds() / 3600
            result["details"].append(f"Age: {age_hours:.1f} hours")

            if age_hours <= 1.5:
                result["status"] = "ok"
                result["summary"] = f"Ingestion on schedule — ran {full_refresh_formatted}"
            elif age_hours <= 3:
                result["status"] = "warning"
                result["summary"] = f"Ingestion slightly delayed — last ran {full_refresh_formatted}"
                result["action_items"].append("Ingestion is behind schedule — check Railway logs")
            else:
                result["status"] = "error"
                result["summary"] = f"Ingestion overdue — last ran {full_refresh_formatted}"
                result["action_items"].append(
                    f"Ingestion has not run for {age_hours:.1f}h — check Railway for crashes"
                )

        # Check source health
        freshness = data.get("freshness", {})
        stale_sources = []
        cached_sources = []
        for source, info in freshness.items():
            if isinstance(info, dict):
                src_status = str(info.get("status", "unknown")).lower()
                if src_status == "stale":
                    stale_sources.append(source)
                    result["details"].append(f"⚠️  {source}: STALE")
                elif src_status == "cached":
                    cached_sources.append(source)
                    result["details"].append(f"⚠️  {source}: CACHED")
                else:
                    result["details"].append(f"✓  {source}: {src_status}")

        if stale_sources:
            if result["status"] == "ok":
                result["status"] = "error"
            result["action_items"].append(
                f"Sources stale: {', '.join(stale_sources)} — investigate ingestion freshness"
            )
        elif cached_sources:
            if result["status"] == "ok":
                result["status"] = "warning"
            result["action_items"].append(
                f"Sources cached: {', '.join(cached_sources)} — monitor for live recovery"
            )

    except urllib.error.URLError as e:
        result["status"] = "error"
        result["summary"] = f"Cannot reach production API: {e}"
        result["action_items"].append("Production API unreachable — check Railway deployment")
    except Exception as e:
        result["status"] = "error"
        result["summary"] = f"Check failed: {e}"

    if not result["summary"]:
        result["summary"] = f"Ingest status: {result['status']}"

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
