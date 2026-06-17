import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { FILTER_ROW_SEARCH_INPUT } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";

type FilterVariant = "vote" | "predict";

interface CategoryRowWithSearchProps {
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
  variant?: FilterVariant;
}

/** Accent styling for the active mobile search chip, per page family. */
const SEARCH_CHIP_ACTIVE: Record<FilterVariant, string> = {
  vote: "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 text-cyan-600 dark:text-cyan-300",
  predict:
    "bg-violet-500/25 dark:bg-violet-500/20 border-violet-500/50 text-violet-600 dark:text-violet-300",
};

const SEARCH_CHIP_INACTIVE =
  "bg-background border-border/60 text-muted-foreground hover:border-foreground/30 dark:text-slate-400 dark:hover:border-slate-600";

export function CategoryRowWithSearch({
  children,
  searchValue,
  onSearchChange,
  placeholder = "Search...",
  testId,
  variant = "vote",
}: CategoryRowWithSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = searchValue.length > 0;

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    }
  }, [expanded]);

  const collapse = () => setExpanded(false);

  return (
    <div className="relative flex items-center gap-3">
      {/* Chips row (rendered once, shared across breakpoints). On mobile the search
          pill is the first item so it scrolls/disappears with the chips. */}
      <ScrollMaskedChipRow className="flex-1 min-w-0">
        <div
          className={cn(
            "flex flex-none items-center gap-1 rounded-full border text-xs font-medium transition-all md:hidden",
            expanded && "invisible",
            hasQuery ? SEARCH_CHIP_ACTIVE[variant] : SEARCH_CHIP_INACTIVE,
          )}
        >
          <button
            type="button"
            aria-label={hasQuery ? "Edit search" : "Search"}
            aria-expanded={expanded}
            onClick={() => setExpanded(true)}
            data-testid={testId ? `${testId}-toggle` : undefined}
            className={cn(
              "flex items-center gap-1.5 py-1.5",
              hasQuery ? "pl-3 pr-1" : "px-3",
            )}
          >
            <Search className="h-4 w-4" />
          </button>
          {hasQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={(e) => {
                e.stopPropagation();
                onSearchChange("");
              }}
              className="mr-1.5 flex h-4 w-4 items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {children}
      </ScrollMaskedChipRow>

      {/* Desktop: persistent search field to the far right (unchanged behavior) */}
      <div className="relative hidden md:block w-[184px] flex-none">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn("pl-10 h-9", FILTER_ROW_SEARCH_INPUT)}
          data-testid={testId}
        />
      </div>

      {/* Mobile: expanded search overlays the whole row for comfortable typing */}
      {expanded && (
        <div className="absolute inset-0 z-10 flex items-center bg-background md:hidden">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") collapse();
              }}
              onBlur={collapse}
              className={cn("pl-10 pr-10 h-8", FILTER_ROW_SEARCH_INPUT)}
              data-testid={testId ? `${testId}-mobile` : undefined}
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={collapse}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
