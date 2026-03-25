# Runbook: Predict page — all market sections fail to load

When every section on **Predict** shows “Couldn’t load …” and **Retry**, the UI is usually fine; **multiple parallel API calls** are failing against the same backend. This is rarely a single broken “market type” in code.

## Quick checks (in order)

1. **Where are you testing?**
   - **Local:** Confirm `npm run dev` is running and the terminal shows Express/Vite activity. If the shell is idle at a prompt, no process is serving `/api/*`.
   - **Production (e.g. Replit):** Open deployment logs. Look for failed builds, crash loops, or OOM during/after deploy.

2. **Browser DevTools → Network**
   - Filter **Fetch/XHR**.
   - If most requests are **(failed)**, **502/503/504**, or **connection refused**, the problem is **reachability or server health**, not one route.
   - If responses are **200** but the UI still errors, inspect the JSON body and the **Console** for parse/runtime errors (uncommon for this symptom).

3. **Call the API directly** (same host as the app)

   - **Process liveness only (no database):**

     `GET /api/health`

     Expect `200` and JSON like `{ "status": "ok", "uptimeSeconds": … }`.

   - **Application + database:**

     `GET /api/system/health`

     Expect `200`. Body includes `database: "connected"` or `"error"` (app may still return 200 with `status: "degraded"` when DB is down — see that response).

4. **Sample market endpoints**

   - `GET /api/open-markets`
   - `GET /api/native-markets/updown`

   If these fail with the same status as above, treat as **global** backend/DB issue.

5. **Server logs**

   Search for database connection errors, timeouts, and uncaught exceptions during requests.

## “Retry loading bets” vs world/native markets

**Retry loading bets** only refetches user predictions (`/api/me/predictions`). If the API is down, that query fails **along with** open/native markets; fixing the server fixes all of them.

## Uptime monitoring (production)

1. Use an external monitor (e.g. UptimeRobot, Better Stack, Pingdom, or your cloud provider’s health checks).
2. Point HTTP checks at:
   - **`GET https://<your-production-host>/api/health`** — fast signal that the Node process responds.
   - Optionally **`GET https://<your-production-host>/api/system/health`** — includes a DB `SELECT 1` (slightly heavier; use for deeper checks).
3. Alert on **non-200** or **no response** for **N consecutive** failures (e.g. 2–3).
4. Align deploy windows with monitoring so brief restarts are expected; tune alert thresholds to avoid noise.

## Client resilience

The app uses **React Query** with **bounded retries** and exponential backoff for most GET queries (see `client/src/lib/queryClient.ts`). Transient blips during deploy or network may recover without a full page reload.

## Related code

- Predict data: `client/src/pages/PredictPage.tsx`
- Default fetch/retry: `client/src/lib/queryClient.ts`
- Health routes: `server/routes.ts` (`/api/health`, `/api/system/health`)
