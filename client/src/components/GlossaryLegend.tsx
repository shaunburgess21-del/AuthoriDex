import { InfoHint } from "@/components/InfoHint";
import type { GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * One hint per term, for a section that repeats the word in every row.
 * The rows stay plain; the legend is the label.
 */
export function GlossaryLegend({
  terms,
  testId,
  className,
}: {
  terms: Array<{ term: GlossaryKey; label: string }>;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium normal-case tracking-normal text-muted-foreground",
        className,
      )}
      data-testid={testId}
    >
      {terms.map(({ term, label }) => (
        <span key={term} className="inline-flex items-center gap-1">
          {label}
          <InfoHint term={term} side="top" className="h-3 w-3" />
        </span>
      ))}
    </div>
  );
}

export const SHARES_AND_PNL_TERMS = [
  { term: "shares" as const, label: "shares" },
  { term: "pnl" as const, label: "P&L" },
];
