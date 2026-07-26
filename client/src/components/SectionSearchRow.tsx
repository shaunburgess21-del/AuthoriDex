import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FILTER_ROW_SEARCH_INPUT } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";

interface SectionSearchRowProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
  className?: string;
}

/**
 * Always-expanded search field for section headers. Category chips moved to the
 * page-level GlobalCategoryBar, so each section keeps only its search, spanning
 * the full row width on all breakpoints.
 */
export function SectionSearchRow({
  value,
  onChange,
  placeholder = "Search...",
  testId,
  className,
}: SectionSearchRowProps) {
  const hasQuery = value.length > 0;

  return (
    <div className={cn("flex", className)}>
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("pl-10 h-9", hasQuery && "pr-9", FILTER_ROW_SEARCH_INPUT)}
          data-testid={testId}
        />
        {hasQuery && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
