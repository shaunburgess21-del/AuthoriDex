#!/usr/bin/env python3
"""
AuthoriDex — Scheduler Frequency Check
Verifies ingestion and LiveTick are firing on schedule.
Run: python ops/check_frequencies.py
"""

import json
import os
import urllib.request
from datetime import datetime, timezone

BASE_URL = os.environ.get(
    "AUTHORIDEX_API_URL",
    "https://authoridex-production.up.railway.app"
)

def parse_time(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None

def age_minutes(dt):
    if not dt:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds() / 60

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

        # Check full ingestion frequency (should run ~hourly)
        full_refresh_at = parse_time(data.get("fullRefreshAt"))
        full_age = age_minutes(full_refresh_at)

        if full_age is not None:
            result["details"].append(
                f"Last full ingestion: {full_age:.0f} min ago (expected: <70 min)"
            )
            if full_age <= 70:
                result["details"].append("✅ Full ingestion frequency: ON SCHEDULE")
            elif full_age <= 120:
                result["status"] = "warning"
                result["details"].append("⚠️  Full ingestion frequency: SLIGHTLY DELAYED")
                result["action_items"].append(
                    f"Full ingestion ran {full_age:.0f} min ago — expected hourly"
                )
            else:
                result["status"] = "error"
                result["details"].append("❌ Full ingestion frequency: OVERDUE")
                result["action_items"].append(
                    f"Full ingestion is {full_age:.0f} min overdue — check Railway scheduler"
                )

        # Check LiveTick frequency (should run ~every 10 min)
        live_updated_at = parse_time(data.get("liveUpdatedAt"))
        live_age = age_minutes(live_updated_at)

        if live_age is not None:
            result["details"].append(
                f"Last LiveTick: {live_age:.0f} min ago (expected: <15 min)"
            )
            if live_age <= 15:
                result["details"].append("✅ LiveTick frequency: ON SCHEDULE")
            elif live_age <= 30:
                result["status"] = "warning" if result["status"] == "ok" else result["status"]
                result["details"].append("⚠️  LiveTick frequency: SLIGHTLY DELAYED")
                result["action_items"].append(
                    f"LiveTick ran {live_age:.0f} min ago — expected every 10 min"
                )
            else:
                result["status"] = "error"
                result["details"].append("❌ LiveTick frequency: OVERDUE")
                result["action_items"].append(
                    f"LiveTick is {live_age:.0f} min overdue — scheduler may be down"
                )

        # Summary
        if result["status"] == "ok":
            result["summary"] = "All schedulers firing on schedule"
        elif result["status"] == "warning":
            result["summary"] = "Schedulers slightly off schedule — monitor"
        else:
            result["summary"] = "Scheduler(s) overdue — immediate investigation needed"

    except urllib.error.URLError as e:
        result["status"] = "error"
        result["summary"] = f"Cannot reach production API: {e}"
        result["action_items"].append("Production API unreachable — check Railway deployment")
    except Exception as e:
        result["status"] = "error"
        result["summary"] = f"Check failed: {e}"

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
