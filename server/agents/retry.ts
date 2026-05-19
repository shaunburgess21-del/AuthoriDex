/**
 * Generic async retry-with-backoff helper.
 *
 * Lives in its own module (not co-located with `runtime-state.ts`) so
 * unit tests can exercise it without pulling in `server/db.ts`, which
 * insists on a `DATABASE_URL` at import time. The pattern mirrors
 * `drainBreaker-evaluate.ts`: pure helper here, DB-touching shell
 * imports it from the consumer module.
 *
 * Designed for short transient-error budgets (e.g. boot-time pooler
 * warmup) — three attempts inside a few hundred ms. NOT a substitute
 * for a structured retry library when the work is expensive or the
 * error class needs filtering. Every thrown error is treated as
 * retryable; if the work fails on the final attempt the original
 * error is propagated unchanged.
 */

export interface RetryOptions {
  /** Total number of attempts. `attempts: 3` means up to 2 retries
   *  after the initial failure. Must be a positive integer. */
  attempts: number;
  /** Returns the pause (ms) between a just-failed attempt and the next
   *  one. Receives the 0-based index of the attempt that just failed.
   *  Callers can return a constant (fixed), `100 * (n + 1)` (linear),
   *  `100 * 2 ** n` (exponential), etc. */
  delayMs: (attempt: number) => number;
  /** Override for tests — defaults to `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional observation hook fired ONLY when an attempt fails AND
   *  another retry is still budgeted. Receives the 0-based index of
   *  the failed attempt and the error. Use to surface "swallowed"
   *  transient errors to ops without flipping them into hard failures.
   *  The final-attempt failure is intentionally NOT reported here —
   *  that bubbles up through the throw so the caller's catch (or
   *  fail-open branch) is the single source of truth for "we gave up". */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  if (!Number.isFinite(opts.attempts) || opts.attempts < 1) {
    throw new Error("retryWithBackoff: attempts must be a positive integer");
  }
  const totalAttempts = Math.floor(opts.attempts);
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < totalAttempts - 1) {
        // onRetry is observation-only — a noisy hook (e.g. misconfigured
        // logger) must not derail recovery. Swallow + console.error so
        // ops can still see the bug without losing the retry budget.
        if (opts.onRetry) {
          try {
            opts.onRetry(attempt, err);
          } catch (hookErr) {
            console.error("[retryWithBackoff] onRetry hook threw:", hookErr);
          }
        }
        await sleep(opts.delayMs(attempt));
      }
    }
  }
  throw lastErr;
}
