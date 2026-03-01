#!/usr/bin/env python3
"""
AuthoriDex — External Source Health Check
Checks all external API sources via the freshness endpoint.
Run: python ops/check_sources.py
"""

import json
import os
import urllib.request

BASE_URL = os.environ.get(
    "AUTHORIDEX_API_URL",
    "https://authoridex-production.up.railway.app"
)

SOURCE_LABELS = {
    "serper": "Serper (Google Search)",
    "mediastack": "Mediastack (News)",
    "wiki": "Wikipedia Pageviews",
    "gdelt": "GDELT (Global Events)"
}

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

        sources = data.get("sources", {})

        if not sources:
            result["status"] = "warning"
            result["summary"] = "No source data returned from API"
            result["action_items"].append("Freshness API returned no source health data")
            print(json.dumps(result, indent=2))
            return

        healthy = []
        degraded = []
        outage = []

        for source, info in sources.items():
            label = SOURCE_LABELS.get(source, source)
            if isinstance(info, dict):
                src_status = str(info.get("status", "unknown")).upper()
                last_healthy = info.get("lastHealthy", "unknown")
                fails = info.get("consecutiveFails", 0)

                if "OUTAGE" in src_status:
                    outage.append(source)
                    result["details"].append(
                        f"❌ {label}: OUTAGE (fails={fails}, last healthy={last_healthy})"
                    )
                    result["action_items"].append(
                        f"{label} is in OUTAGE — check API key validity and rate limits"
                    )
                elif "DEGRADED" in src_status or "CACHED" in src_status:
                    degraded.append(source)
                    result["details"].append(
                        f"⚠️  {label}: DEGRADED (using cache, last healthy={last_healthy})"
                    )
                    result["action_items"].append(
                        f"{label} is degraded — monitor for recovery"
                    )
                else:
                    healthy.append(source)
                    result["details"].append(f"✅ {label}: LIVE")
            else:
                result["details"].append(f"? {label}: {info}")

        # Set overall status
        if outage:
            result["status"] = "error" if len(outage) >= 2 else "warning"
        elif degraded:
            result["status"] = "warning"

        total = len(sources)
        result["summary"] = (
            f"{len(healthy)}/{total} sources live"
            + (f", {len(degraded)} degraded" if degraded else "")
            + (f", {len(outage)} in outage" if outage else "")
        )

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
