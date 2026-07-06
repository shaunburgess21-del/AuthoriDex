/**
 * Shared admin list row for the native (auto-generated) prediction markets:
 * Weekly Jackpot, Weekly Up/Down, Head-to-Head, and Category Races.
 *
 * These four sub-tabs previously each inlined a near-identical single-row
 * layout that clipped titles and used tiny icon buttons on phones. This row
 * stacks on mobile (content on top, a full-width action row below) with
 * touch-friendly controls, matching the World Markets redesign, while
 * keeping the desktop single-row look.
 *
 * Presentational only — the parent (AdminDashboard) owns all mutations and
 * passes intents down via callbacks.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Gavel, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PredictionMarket } from "@/pages/admin/adminTypes";

interface NativeMarketRowProps {
  market: PredictionMarket;
  testIdPrefix: string;
  /** Show the status badge (jackpot / h2h / gainer) — hidden for up/down. */
  showStatus?: boolean;
  /** Show the category badge when present — hidden for jackpot. */
  showCategory?: boolean;
  /** Show the "Wk N" label — hidden for jackpot. */
  showWeek?: boolean;
  /** Bulk-select checkbox (up/down only). */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
  onVisibilityChange: (visibility: string) => void;
  onToggleFeatured: () => void;
  /** Settle handler — only rendered when the market is OPEN. */
  onSettle?: () => void;
  /** Delete handler — omitted for jackpot (managed by the generator). */
  onDelete?: () => void;
}

export function NativeMarketRow({
  market,
  testIdPrefix,
  showStatus = true,
  showCategory = true,
  showWeek = true,
  selectable = false,
  selected = false,
  onSelectedChange,
  onVisibilityChange,
  onToggleFeatured,
  onSettle,
  onDelete,
}: NativeMarketRowProps) {
  return (
    <div
      className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 p-3 rounded-lg border"
      data-testid={`${testIdPrefix}-row-${market.id}`}
    >
      <div className="flex items-start md:items-center gap-2 min-w-0 flex-1">
        {selectable && (
          <label className="flex items-center shrink-0 p-1 -m-1 cursor-pointer">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelectedChange?.(e.target.checked)}
              className="rounded h-4 w-4"
            />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug line-clamp-2 md:line-clamp-1 text-sm">{market.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge
              variant={
                market.visibility === "live" ? "default" :
                market.visibility === "inactive" ? "secondary" : "outline"
              }
              className="text-xs"
            >
              {market.visibility}
            </Badge>
            {showStatus && <Badge variant="outline" className="text-xs">{market.status}</Badge>}
            {showCategory && market.category && (
              <Badge variant="outline" className="text-xs capitalize">{market.category}</Badge>
            )}
            {market.featured && (
              <Badge variant="outline" className="text-xs border-yellow-500/40 dark:border-yellow-500/30 text-yellow-500">
                <Star className="h-3 w-3 mr-1" />Featured
              </Badge>
            )}
            {showWeek && (
              <span className="text-xs text-muted-foreground">Wk {market.weekNumber || "-"}</span>
            )}
          </div>
        </div>
      </div>
      <div className={cn("flex items-center gap-2 md:shrink-0", selectable && "pl-7 md:pl-0")}>
        <Select value={market.visibility || "live"} onValueChange={onVisibilityChange}>
          <SelectTrigger className="flex-1 md:flex-none md:w-[110px] h-10 md:h-9" aria-label="Visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shrink-0"
          aria-label="Toggle featured"
          onClick={onToggleFeatured}
        >
          <Star className={cn("h-4 w-4", market.featured && "fill-yellow-500 text-yellow-500")} />
        </Button>
        {onSettle && market.status === "OPEN" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-9 md:w-9 shrink-0"
            aria-label="Settle"
            onClick={onSettle}
            data-testid={`${testIdPrefix}-settle-${market.id}`}
          >
            <Gavel className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-9 md:w-9 shrink-0"
            aria-label="Delete"
            onClick={onDelete}
            data-testid={`${testIdPrefix}-delete-${market.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}
