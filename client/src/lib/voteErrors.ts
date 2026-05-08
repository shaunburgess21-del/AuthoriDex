/**
 * Parse an error from a vote/prediction submission into a user-friendly
 * message + optional `retryAfter` (seconds).
 *
 * Extracted from VotePage.tsx so other vote surfaces (PersonDetailPage,
 * AnimatedSentimentVotingWidget, etc.) can use the same rate-limit-aware
 * UX instead of showing raw `error.message`.
 *
 * Handles three shapes:
 *   1. Our `ApiError` from `client/src/lib/api.ts` — sets `.retryAfter` on 429.
 *   2. Messages of the form "429: {json body}" thrown by legacy fetch helpers.
 *   3. Anything else → fallback to `error.message` or a generic string.
 */
/**
 * True when the API rejected the vote because the anonymous budget is exhausted
 * (`403` + `{ error: "budget_exhausted" }`). Matches `ApiError` messages from
 * `apiRequest` (`"<status>: <json body>"`).
 */
export function isBudgetExhaustedVoteError(err: unknown): boolean {
  if (!(err instanceof Error) || !err.message) return false;
  const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
  if (!jsonMatch) return false;
  try {
    const j = JSON.parse(jsonMatch[1]) as { error?: string };
    return j.error === "budget_exhausted";
  } catch {
    return false;
  }
}

export function parseVoteError(err: unknown): { message: string; retryAfter?: number } {
  const retryAfter = (err as { retryAfter?: number } | null | undefined)?.retryAfter;
  if (err instanceof Error && err.message) {
    // Shape: "429: { "error": "…" }"
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return { message: j.error, retryAfter };
      } catch {
        /* ignore — fall through */
      }
    }
    if (err.message.startsWith("429")) {
      return {
        message: "Too many votes. Please slow down.",
        retryAfter: retryAfter ?? 60,
      };
    }
    return { message: err.message, retryAfter };
  }
  return { message: "Something went wrong. Please try again." };
}
