/**
 * Idempotency-Key validation for human-facing trade routes.
 *
 * The HTTP `Idempotency-Key` header (per the IETF httpapi draft) lets
 * a client retry a POST without producing duplicate state changes.
 * We accept it in two shapes:
 *
 *   1. UUID v4 (`crypto.randomUUID()` from a modern browser) — the
 *      preferred client-generated form. 36 chars including dashes.
 *   2. URL-safe alphanumeric token, 16–64 chars, `[A-Za-z0-9_-]+`.
 *      A defensive fallback for older clients or operators issuing
 *      synthetic retries via curl.
 *
 * Reject malformed input by returning `null` rather than throwing —
 * the route layer treats invalid keys the same as missing keys (the
 * trade proceeds without dedupe), which preserves backward compat for
 * naive retry loops that might send weird strings.
 *
 * Trim whitespace before validating so a header set with a trailing
 * newline (rare but seen with some HTTP clients) still passes.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidIdempotencyKey(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const key = raw.trim();
  if (key.length === 0) return false;
  return UUID_V4.test(key) || SAFE_TOKEN.test(key);
}

/**
 * Parse the key off a route input (header preferred, body fallback)
 * and return a normalised string or `null` if invalid/missing.
 *
 * Centralised here so both /buy and /sell routes use identical
 * acceptance logic.
 */
export function parseIdempotencyKey(input: {
  header?: string | string[] | undefined;
  body?: unknown;
}): string | null {
  const candidates: unknown[] = [];
  if (typeof input.header === "string") candidates.push(input.header);
  else if (Array.isArray(input.header) && input.header[0]) candidates.push(input.header[0]);
  if (typeof input.body === "string") candidates.push(input.body);

  for (const candidate of candidates) {
    if (isValidIdempotencyKey(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}
