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

      {/* Desktop: full 4-column stats */}
      <div className="hidden md:flex md:flex-col">
        <div className="grid grid-cols-4 gap-x-2 gap-y-1">
          <p className="truncate text-center font-mono text-base font-bold leading-tight text-foreground">
            {fameIndex}
          </p>
          <div className="flex min-w-0 justify-center">
            <TrendBadge value={stats.change24h} size="default" showIcon={false} />
          </div>
          <div className="flex min-w-0 justify-center">
            <TrendBadge value={stats.change7d} size="default" showIcon={false} />
          </div>
          <div className="min-w-0 text-center">
            <ApprovalValue rating={stats.approvalAvgRating} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-x-2">
          <div className="text-center text-[11px] uppercase tracking-wide leading-tight text-muted-foreground">
            <span className="block">Trend</span>
            <span className="block">Score</span>
          </div>
          <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            24h
          </p>
          <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            7d
          </p>
          <div className="text-center text-[11px] uppercase tracking-wide leading-tight text-muted-foreground">
            <span className="block">Approval</span>
            <span className="block">Rating</span>
          </div>
        </div>
      </div>
    </div>
  );
}
