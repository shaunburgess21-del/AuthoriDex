/**
 * Serper news cache TTL — no DB imports (safe for unit tests).
 */

import {
  resolveCurrentsRefreshIntervalMinutes,
  resolveMediastackRefreshIntervalMinutes,
} from "./news-refresh-intervals";

/**
 * Serper news cache TTL — pinned to paid-provider refresh cadence so union
 * contributors stay in sync (Mediastack default 3h, Currents default 2h).
 * Override via SERPER_NEWS_CACHE_TTL_HOURS for rollback without redeploy.
 */
export function getSerperNewsCacheTtlHours(): number {
  const override = parseFloat(process.env.SERPER_NEWS_CACHE_TTL_HOURS ?? "");
  if (Number.isFinite(override) && override > 0) return override;
  return Math.max(
    resolveMediastackRefreshIntervalMinutes(),
    resolveCurrentsRefreshIntervalMinutes(),
  ) / 60;
}
