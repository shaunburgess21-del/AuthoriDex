import { SentimentPollResultsBars } from "@/components/sentiment/SentimentPollResultsBars";
import type { VoicesEntity } from "./types";

type SentimentResults = NonNullable<VoicesEntity["sentimentResults"]>;

interface VoiceSentimentPollPreviewProps {
  results: SentimentResults;
}

export function VoiceSentimentPollPreview({ results }: VoiceSentimentPollPreviewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end pt-1">
      <SentimentPollResultsBars
        agreePercent={results.agreePercent}
        neutralPercent={results.neutralPercent}
        disagreePercent={results.disagreePercent}
        compact
      />
    </div>
  );
}
