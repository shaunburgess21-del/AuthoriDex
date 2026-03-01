#!/usr/bin/env python3
"""
AuthoriDex — Full Production Health Check
Run: python ops/full_check.py
"""

import subprocess
import sys
import json
from datetime import datetime

def run_check(script_name):
    try:
        result = subprocess.run(
            [sys.executable, f"ops/{script_name}"],
            capture_output=True, text=True, timeout=30
        )
        if result.stdout:
            return json.loads(result.stdout)
        return {"status": "error", "detail": result.stderr or "No output"}
    except subprocess.TimeoutExpired:
        return {"status": "error", "detail": f"{script_name} timed out"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

def emoji(status):
    return "✅" if status == "ok" else "⚠️" if status == "warning" else "❌"

def main():
    print("=" * 60)
    print("  AuthoriDex — Trend Score Engine Health Report")
    print(f"  {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    checks = [
        ("check_snapshots.py",  "Snapshots"),
        ("check_ingests.py",    "Ingests"),
        ("check_sources.py",    "External Sources"),
        ("check_frequencies.py","Frequencies"),
    ]

    results = {}
    action_items = []
    overall = "ok"

    for script, label in checks:
        print(f"\nRunning {label} check...")
        result = run_check(script)
        results[label] = result
        status = result.get("status", "error")

        print(f"  {emoji(status)} {label}: {result.get('summary', result.get('detail', 'No detail'))}")

        if result.get("details"):
            for d in result["details"]:
                print(f"     → {d}")

        if status == "warning" and overall == "ok":
            overall = "warning"
        elif status == "error":
            overall = "error"

        if status in ("warning", "error"):
            for item in result.get("action_items", []):
                action_items.append(f"[{status.upper()}] {label}: {item}")

    print("\n" + "=" * 60)
    print(f"  Overall Status: {emoji(overall)} {overall.upper()}")
    print("=" * 60)

    if action_items:
        print("\nAction Items:")
        for i, item in enumerate(action_items, 1):
            print(f"  {i}. {item}")
    else:
        print("\n✅ No action items — all systems nominal.")

    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
