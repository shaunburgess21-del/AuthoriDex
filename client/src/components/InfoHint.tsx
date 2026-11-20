import { Info } from "lucide-react";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Tap-friendly one-sentence explanation. Desktop hovers; touch opens a
 * popover (TouchTooltip). The sentence lives in `GLOSSARY` so every
 * surface says the same thing.
 */
export function InfoHint({
  term,
  testId,
  className,
  side = "top",
  align = "center",
}: {
  term: GlossaryKey;
  testId?: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const sentence = GLOSSARY[term];
  return (
    <TouchTooltip
      content={<p className="text-xs leading-snug normal-case tracking-normal">{sentence}</p>}
      side={side}
      align={align}
      contentClassName="max-w-[220px]"
      triggerAriaLabel={sentence}
    >
      <Info
        className={cn("h-3.5 w-3.5 text-muted-foreground/70 cursor-help", className)}
        data-testid={testId ?? `info-${term}`}
        aria-hidden
      />
    </TouchTooltip>
  );
}
