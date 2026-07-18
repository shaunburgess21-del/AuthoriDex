import { Vote as VoteIcon } from "lucide-react";
import type { VoicesEntity } from "./types";

type InductionPreview = NonNullable<VoicesEntity["inductionPreview"]>;

interface VoiceInductionProfilePreviewProps {
  preview: InductionPreview;
}

export function VoiceInductionProfilePreview({ preview }: VoiceInductionProfilePreviewProps) {
  const voteLabel =
    preview.seedVotes === 1 ? "1 induction vote" : `${preview.seedVotes.toLocaleString("en-US")} induction votes`;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end pt-1">
      <div className="rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-1.5 dark:border-cyan-500/20 dark:bg-cyan-500/[0.04]">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Induction Queue
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <VoteIcon className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="text-sm font-medium text-cyan-700 dark:text-cyan-400">Vote to Induct</span>
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{voteLabel}</p>
      </div>
    </div>
  );
}
