import { ToastAction } from "@/components/ui/toast";

export function isUnauthorizedApiError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) return false;
  const m = error.message;
  if (/^401:/.test(m)) return true;
  if (m.includes("Unauthorized")) return true;
  return false;
}

export function signInToVoteToastOptions(onSignIn: () => void) {
  return {
    title: "Sign in to vote",
    description: "Create a free account to record your vote on VoxDex.",
    action: (
      <ToastAction altText="Sign in" onClick={onSignIn}>
        Sign in
      </ToastAction>
    ),
  };
}
