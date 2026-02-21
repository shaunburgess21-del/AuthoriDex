import { Info, Search, Newspaper, BookOpen } from "lucide-react";
import { TouchTooltip } from "@/components/ui/touch-tooltip";

function TrendScoreInfoContent() {
  return (
    <div className="space-y-3">
      <p className="font-semibold text-sm">How Trend Score Works</p>
      <p className="text-xs text-muted-foreground">
        Trend Score measures real-world attention using three independent signals:
      </p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 text-xs">
          <Search className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <span><span className="font-medium">Search interest</span> — how often people search for them</span>
        </li>
        <li className="flex items-center gap-2 text-xs">
          <Newspaper className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span><span className="font-medium">News coverage</span> — how often they appear in recent articles</span>
        </li>
        <li className="flex items-center gap-2 text-xs">
          <BookOpen className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span><span className="font-medium">Wikipedia activity</span> — how often people read about them</span>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        We combine these third-party signals into a single score that updates as new data comes in. A higher score means more attention right now.
      </p>
      <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border/50">
        Sources: Search · News · Wikipedia
      </p>
    </div>
  );
}

export function TrendScoreInfoIcon({ className, testId }: { className?: string; testId: string }) {
  return (
    <TouchTooltip
      content={<TrendScoreInfoContent />}
      side="bottom"
      align="start"
      contentClassName="max-w-[300px]"
    >
      <Info
        className={className ?? "h-3.5 w-3.5 text-muted-foreground/50 cursor-help"}
        data-testid={testId}
      />
    </TouchTooltip>
  );
}
