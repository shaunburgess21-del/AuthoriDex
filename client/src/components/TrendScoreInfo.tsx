import { Info, Newspaper, BookOpen, Search } from "lucide-react";
import { Link } from "wouter";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

const INSIGHTS_APPROVAL_HREF = "/insights?tab=approval";

function InsightsApprovalLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={INSIGHTS_APPROVAL_HREF}
      className="font-medium text-primary hover:text-primary/80 underline underline-offset-2"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </Link>
  );
}

export function TrendScoreInfoContent() {
  const isMobile = useIsMobile();

  return (
    <div className="space-y-3 normal-case tracking-normal">
      <p className="font-semibold text-sm">How Trend Score Works</p>
      <p className="text-xs text-muted-foreground">
        Trend Score measures how much attention a person is getting recently, using multiple streams of data from public sources:
      </p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 text-xs">
          <Newspaper className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span><span className="font-medium">News coverage</span> — how often they appear in recent articles</span>
        </li>
        <li className="flex items-center gap-2 text-xs">
          <BookOpen className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span><span className="font-medium">Wikipedia activity</span> — how often people read about them</span>
        </li>
        <li className="flex items-center gap-2 text-xs">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span><span className="font-medium">Search and mentions</span> — how they are trending on the web</span>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        We combine these signals into a single score that updates as new data comes in. A higher score means more attention recently.
      </p>
      <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
        Trend Score is total attention—positive and negative—not community approval.{" "}
        {isMobile ? (
          <>
            For approval ratings, see the <InsightsApprovalLink>Insights</InsightsApprovalLink> page.
          </>
        ) : (
          <>
            For approval ratings, see the Approval column (or the{" "}
            <InsightsApprovalLink>Insights</InsightsApprovalLink> page).
          </>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border/50">
        API Sources: Mediastack · Wikipedia · SerpApi · CurrentsAPI · APILayer · DataForSEO · OpenAI · Serper
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
      showCloseButton
    >
      <Info
        className={className ?? "h-3.5 w-3.5 text-muted-foreground/50 cursor-help"}
        data-testid={testId}
      />
    </TouchTooltip>
  );
}
