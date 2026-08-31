import { TrendBadge } from "@/components/TrendBadge";
import { getApprovalColor } from "@/lib/formatNumber";
import type { VoicesEntity } from "./types";

type ProfileStats = NonNullable<VoicesEntity["profileStats"]>;

interface VoiceProfilePreviewStatsProps {
  stats: ProfileStats;
}

function ApprovalValue({ rating }: { rating: number | null }) {
  if (rating != null) {
    return (
      <p className="truncate font-mono text-base font-bold leading-tight">
        <span style={{ color: getApprovalColor(rating) }}>{rating.toFixed(1)}</span>
        <span className="text-sm text-muted-foreground">/5</span>
      </p>
    );
  }
  return (
    <p className="truncate font-mono text-base font-bold leading-tight text-muted-foreground">
      —
    </p>
  );
}

export function VoiceProfilePreviewStats({ stats }: VoiceProfilePreviewStatsProps) {
  const fameIndex =
    stats.fameIndex != null ? stats.fameIndex.toLocaleString("en-US") : "—";

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end">
      {/* Mobile: Trend Score + Approval only */}
      <div className="md:hidden">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <p className="truncate text-center font-mono text-base font-bold leading-tight text-foreground">
            {fameIndex}
          </p>
          <div className="min-w-0 text-center">
            <ApprovalValue rating={stats.approvalAvgRating} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            Trend
          </p>
          <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            Approval
          </p>
        </div>
      </div>

      {/* Desktop: 4 stacked columns so 24h/7d badges grow down to the label line */}
      <div className="hidden md:grid md:grid-cols-4 md:items-stretch md:gap-x-2">
        <div className="flex h-full min-w-0 flex-col items-center">
          <p className="truncate text-center font-mono text-base font-bold leading-tight text-foreground">
            {fameIndex}
          </p>
          <div className="mt-auto text-center text-[11px] uppercase tracking-wide leading-tight text-muted-foreground">
            <span className="block">Trend</span>
            <span className="block">Score</span>
          </div>
        </div>
        <div className="flex h-full min-w-0 flex-col items-center">
          <TrendBadge
            value={stats.change24h}
            size="default"
            showIcon={false}
            className="flex h-auto min-h-[37px] flex-1 py-0 text-base font-bold leading-tight"
          />
          <p className="shrink-0 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            24h
          </p>
        </div>
        <div className="flex h-full min-w-0 flex-col items-center">
          <TrendBadge
            value={stats.change7d}
            size="default"
            showIcon={false}
            className="flex h-auto min-h-[37px] flex-1 py-0 text-base font-bold leading-tight"
          />
          <p className="shrink-0 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            7d
          </p>
        </div>
        <div className="flex h-full min-w-0 flex-col items-center">
          <div className="min-w-0 text-center">
            <ApprovalValue rating={stats.approvalAvgRating} />
          </div>
          <div className="mt-auto text-center text-[11px] uppercase tracking-wide leading-tight text-muted-foreground">
            <span className="block">Approval</span>
            <span className="block">Rating</span>
          </div>
        </div>
      </div>
    </div>
  );
}
