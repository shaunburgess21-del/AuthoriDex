import { Info, Star, Users } from "lucide-react";
import { TouchTooltip } from "@/components/ui/touch-tooltip";

function ApprovalRatingInfoContent() {
  return (
    <div className="space-y-3">
      <p className="font-semibold text-sm">How Approval Rating Works</p>
      <p className="text-xs text-muted-foreground">
        Approval Rating is based only on votes from verified AuthoriDex users — not external public sentiment or APIs.
      </p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 text-xs">
          <Star className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
          <span><span className="font-medium">Rate 1–5</span></span>
        </li>
        <li className="flex items-center gap-2 text-xs">
          <Users className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
          <span><span className="font-medium">One vote</span> per user, per person, per day</span>
        </li>
      </ul>
      <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border/50">
        Shown as a % based on community ratings.
      </p>
    </div>
  );
}

export function ApprovalRatingInfoIcon({ className, testId }: { className?: string; testId: string }) {
  return (
    <TouchTooltip
      content={<ApprovalRatingInfoContent />}
      side="bottom"
      align="start"
      contentClassName="max-w-[280px]"
    >
      <Info
        className={className ?? "h-3.5 w-3.5 text-muted-foreground/50 cursor-help"}
        data-testid={testId}
      />
    </TouchTooltip>
  );
}
