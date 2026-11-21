import { toast } from "sonner";
import { parseVoteError } from "@/lib/voteErrors";
import { isAlreadyPresentedVoteError } from "@/lib/sentimentVotePresented";

export function toastUnhandledSentimentVoteError(err: unknown): void {
  if (isAlreadyPresentedVoteError(err)) return;
  const parsed = parseVoteError(err);
  toast.error("Couldn't record vote", { description: parsed.message });
}
