import { Link } from "wouter";
import { LeaderboardRankAvatar } from "@/components/LeaderboardRankAvatar";
import { getCategoryTextColor } from "@/components/CategoryPill";
import { SentimentMiniBar } from "./SentimentMiniBar";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { cn } from "@/lib/utils";

export interface WebSentimentRowData {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  positivePct: number;
  positive: number;
  negative: number;
  carriedForward: boolean;
}

function sentimentBand(pct: number): string {
  if (pct >= 75) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 25) return "text-amber-600 dark:text-amber-400";
  return "text-red-500";
}

export function WebSentimentLeaderboardRow({
  row,
  displayRank,
}: {
  row: WebSentimentRowData;
  displayRank: number;
}) {
  const categoryRegistry = useCategoryRegistry();
  const mentionCount = row.positive + row.negative;

  // Podium accents (ranks 1–3): pulse-style card variant + numeral tint,
  // matching LeaderboardRow on the Home/Approval boards.
  const rowVariantClass =
    displayRank === 1
      ? "lb-row-gold"
      : displayRank === 2
        ? "lb-row-silver"
        : displayRank === 3
          ? "lb-row-bronze"
          : "lb-row-neutral";
  const rankNumeralClass =
    displayRank === 1
      ? "text-amber-600 dark:text-amber-400"
      : displayRank === 2
        ? "text-slate-600 dark:text-slate-300"
        : displayRank === 3
          ? "text-orange-600 dark:text-orange-400"
          : null;

  return (
      <Link
        href={`/person/${row.id}`}
        onClick={() =>
          logInsightsEvent("crowd", "web_sentiment_row_click", {
            personId: row.id,
          })
        }
        // No-op touch handler: iOS Safari only applies :active (the press
        // glow/expand in .lb-row-card) to elements with a touch listener.
        onTouchStart={() => {}}
        className={`lb-row-enter lb-row-card ${rowVariantClass} flex items-center gap-3 sm:gap-4 lg:gap-5 pl-2 pr-2 py-4 sm:pl-3 sm:pr-6 sm:py-5 rounded-xl cursor-pointer`}
        data-testid={`web-sentiment-row-${row.id}`}
      >
        <LeaderboardRankAvatar
          rank={displayRank}
          rankSlot={
            rankNumeralClass ? (
              <span
                className={cn(
                  "font-mono font-semibold tabular-nums text-center leading-none px-0.5 text-[16px] sm:text-[18px]",
                  rankNumeralClass,
                )}
              >
                {displayRank}
              </span>
            ) : undefined
          }
          name={row.name}
          avatar={row.avatar}
        />

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm sm:text-base min-w-0 truncate">{row.name}</h3>
          {row.category && (
            <p
              className={cn(
                "hidden md:flex items-center gap-1.5 text-sm truncate",
                getCategoryTextColor(
                  row.category,
                  categoryRegistry.resolveCanonicalId(row.category),
                ),
              )}
            >
              <span className="truncate">
                {categoryRegistry.getDisplayLabel(row.category)}
              </span>
            </p>
          )}
          <p className="md:hidden text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
            <span className="tabular-nums">
              {mentionCount.toLocaleString("en-US")} mentions
            </span>
            {row.carriedForward && (
              <span
                className="ml-1.5 italic text-muted-foreground/70"
                title="No fresh web citations this cycle — showing the last available reading."
              >
                · carried forward
              </span>
            )}
          </p>
        </div>

        <div className="hidden lg:flex w-[96px] shrink-0 items-center justify-end">
          <SentimentMiniBar
            positive={row.positive}
            negative={row.negative}
            showCounts={false}
            className="mt-0 w-full"
          />
        </div>

        <div className="text-right w-[72px] sm:w-[120px] shrink-0">
          <p
            className={cn(
              "font-mono font-bold text-lg sm:text-2xl tabular-nums leading-none tracking-tight",
              sentimentBand(row.positivePct),
            )}
            data-testid={`web-sentiment-pct-${row.id}`}
          >
            {row.positivePct}%
          </p>
          <p className="hidden sm:block text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
            Sentiment
          </p>
        </div>

        <div className="hidden lg:flex w-[100px] shrink-0 justify-end items-center">
          <p className="font-mono font-semibold text-base tabular-nums text-muted-foreground">
            {mentionCount.toLocaleString("en-US")}
          </p>
        </div>
      </Link>
  );
}
