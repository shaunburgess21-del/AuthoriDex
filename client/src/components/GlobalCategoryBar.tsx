import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { FilterChip, type FilterChipAccent } from "@/components/FilterChip";
import type { SectionCategoryOption } from "@/lib/sectionCategoryFilters";
import { cn } from "@/lib/utils";

interface GlobalCategoryBarProps {
  options: SectionCategoryOption[];
  value: string;
  onChange: (value: string) => void;
  accent?: FilterChipAccent;
  user?: unknown;
  onAuthRequired?: () => void;
  testIdPrefix: string;
  className?: string;
}

/**
 * Page-level category chip row. Rendered inside a sticky bar whose whole
 * surface hides/reveals 1:1 with scroll (see `useScrollHideOffset`), so this
 * component itself stays a plain, constant-layout row — no height animation
 * here (height changes mid-scroll reflow the page and cause jitter).
 */
export function GlobalCategoryBar({
  options,
  value,
  onChange,
  accent = "vote",
  user,
  onAuthRequired,
  testIdPrefix,
  className,
}: GlobalCategoryBarProps) {
  return (
    <div className={cn(className)} data-testid={`${testIdPrefix}-bar`}>
      <ScrollMaskedChipRow activeChipKey={value} className="pb-1">
        {options.map((opt) => (
          <FilterChip
            key={opt.value}
            category={opt.value}
            label={opt.label}
            isActive={value === opt.value}
            onClick={() => onChange(opt.value)}
            testIdPrefix={testIdPrefix}
            user={user}
            onAuthRequired={onAuthRequired}
            accent={accent}
          />
        ))}
      </ScrollMaskedChipRow>
    </div>
  );
}
