/**
 * Shared news-provider refresh cadence (minutes). Single source of truth for
 * Mediastack, Currents, and Serper news cache TTL alignment.
 */

type EnvLike = Pick<NodeJS.ProcessEnv, string>;

export function resolveMediastackRefreshIntervalMinutes(
  env: EnvLike = process.env,
): number {
  const raw = parseInt(env.MEDIASTACK_REFRESH_INTERVAL_MINUTES ?? "240", 10);
  if (!Number.isFinite(raw) || raw < 30 || raw > 360) return 240;
  return raw;
}

export function resolveCurrentsRefreshIntervalMinutes(
  env: EnvLike = process.env,
): number {
  const raw = parseInt(env.CURRENTS_REFRESH_INTERVAL_MINUTES ?? "120", 10);
  if (!Number.isFinite(raw) || raw < 60 || raw > 360) return 120;
  return raw;
}
