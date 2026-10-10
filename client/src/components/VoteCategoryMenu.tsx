/**
 * Mobile Vote category picker. Sits in the section-chip row where the
 * All votes dropdown used to be, and lists the same options as the
 * desktop category chips.
 */
import { useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFilterCategoryIcon } from "@/components/interests/categoryIcons";
import type { SectionCategoryOption } from "@/lib/sectionCategoryFilters";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer";

const FILTER_ACTIVE_PILL =
  "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20";

const FILTER_INACTIVE_PILL =
  "bg-background text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/5 border border-border/60";

interface VoteCategoryMenuProps {
  options: SectionCategoryOption[];
  value: string;
  onChange: (value: string) => void;
  user?: unknown;
  onAuthRequired?: () => void;
}

function OptionList({
  options,
  value,
  onSelect,
  CloseWrapper,
}: {
  options: SectionCategoryOption[];
  value: string;
  onSelect: (next: string) => void;
  CloseWrapper: ComponentType<{ children: ReactNode; asChild?: boolean }>;
}) {
  return (
    <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto py-1" role="menu">
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = getFilterCategoryIcon(option.value);
        return (
          <CloseWrapper key={option.value} asChild>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md transition-colors",
                selected
                  ? "bg-muted/70 text-foreground font-medium"
                  : "hover:bg-muted/60 text-foreground",
              )}
              onClick={() => onSelect(option.value)}
              data-testid={`filter-vote-category-option-${option.value}`}
            >
              <Icon className="h-4 w-4 opacity-60 shrink-0" aria-hidden />
              <span className="flex-1 min-w-0 leading-snug">{option.label}</span>
              {selected ? (
                <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </button>
          </CloseWrapper>
        );
      })}
    </div>
  );
}

export function VoteCategoryMenu({
  options,
  value,
  onChange,
  user,
  onAuthRequired,
}: VoteCategoryMenuProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const pillLabel = !value || value === "all" ? "Categories" : (selected?.label ?? "Categories");
  const filtering = value !== "all";

  const handleSelect = (next: string) => {
    if (next === "favorites" && !user) {
      onAuthRequired?.();
      setOpen(false);
      return;
    }
    onChange(next);
    setOpen(false);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={`Categories: ${pillLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit shrink-0",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            filtering ? FILTER_ACTIVE_PILL : FILTER_INACTIVE_PILL,
          )}
          data-testid="filter-vote-category-menu"
        >
          <span className="max-w-[9rem] truncate">{pillLabel}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 opacity-70 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="px-2 pb-4">
          <DrawerTitle className="px-3 pt-1 pb-2 text-sm font-semibold text-foreground text-left">
            Categories
          </DrawerTitle>
          <OptionList
            options={options}
            value={value}
            onSelect={handleSelect}
            CloseWrapper={DrawerClose}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
