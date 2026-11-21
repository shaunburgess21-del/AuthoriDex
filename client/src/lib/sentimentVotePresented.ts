import { isVoteGateRedirectError } from "@/lib/voteGate";

/**
 * True when a vote rejection was already shown to the user.
 * API failures toast inside the mutation `onError` (`ApiError`).
 * A gate failure redirects to signup. The card must not toast those again.
 * Anything else never left the card and used to be swallowed.
 */
export function isAlreadyPresentedVoteError(err: unknown): boolean {
  if (isVoteGateRedirectError(err)) return true;
  return err instanceof Error && err.name === "ApiError";
}
