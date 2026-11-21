/**
 * Category picker for Vote and Predict. Drawer on mobile, popover on desktop.
 * The trigger is a quiet filter chip ("Categories") until a category is on,
 * then it takes that category's registry label and chip colour.
 */
import { useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { getFilterCategoryIcon } from "@/components/interests/categoryIcons";
import {
  categoryMenuFaceClass,
  categoryMenuIsFiltered,
  categoryMenuTriggerLabel,
} from "@/lib/categoryMenuTrigger";
import type { SectionCategoryOption } from "@/lib/sectionCategoryFilters";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer";

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

type AsChildTrigger = ComponentType<{ asChild?: boolean; children?: ReactNode }>;

function CategoryMenuFace({
  open,
  pillLabel,
  filtered,
  faceClass,
  onClear,
  Trigger,
}: {
  open: boolean;
  pillLabel: string;
  filtered: boolean;
  faceClass: string;
  onClear: (event: MouseEvent<HTMLButtonElement>) => void;
  Trigger: AsChildTrigger;
}) {
  return (
    <div className="inline-flex max-w-full shrink-0 items-center gap-2" data-testid="vote-category-filter">
      <div
        className={cn(
          "inline-flex max-w-full items-center rounded-lg text-sm font-medium whitespace-nowrap",
          faceClass,
        )}
      >
        <Trigger asChild>
          <button
            type="button"
            aria-label={`Categories: ${pillLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            className="category-menu-trigger tap-44 inline-flex min-w-0 items-center gap-1.5 self-stretch rounded-lg py-2 pl-2.5 pr-2 focus-visible:outline-none sm:pl-3 sm:pr-2.5"
            data-testid="filter-vote-category-menu"
            onClick={(event) => {
              // Drop focus before the sheet aria-hides the sticky bar that contains
              // this button. Otherwise Chrome warns that aria-hidden hid a focused control.
              event.currentTarget.blur();
            }}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
            <span className="max-w-[12ch] truncate" title={pillLabel}>
              {pillLabel}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </Trigger>
        {filtered ? (
          <button
            type="button"
            aria-label="Clear category filter"
            data-testid="filter-vote-category-clear"
            className="mr-1 inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center self-stretch rounded-md px-1 text-current/80 hover:bg-current/10 hover:text-current active:bg-current/20 focus-visible:outline-none"
            onPointerDown={(event) => {
              // Sibling of the menu trigger — this press must not open it.
              event.stopPropagation();
            }}
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <span
        aria-hidden
        className="h-5 w-px shrink-0 self-center bg-foreground/30"
        data-testid="category-filter-divider"
      />
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
  const pillLabel = categoryMenuTriggerLabel(value, selected?.label);
  const filtered = categoryMenuIsFiltered(value);
  const faceClass = categoryMenuFaceClass(value);

  const isMobile = useIsMobile();

  const handleSelect = (next: string) => {
    if (next === "favorites" && !user) {
      onAuthRequired?.();
      setOpen(false);
      return;
    }
    onChange(next);
    setOpen(false);
  };

  const clearFilter = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onChange("all");
  };

  const face = (
    <CategoryMenuFace
      open={open}
      pillLabel={pillLabel}
      filtered={filtered}
      faceClass={faceClass}
      onClear={clearFilter}
      Trigger={isMobile ? DrawerTrigger : PopoverTrigger}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        {face}
        <DrawerContent
          onOpenAutoFocus={(event) => {
            // The sheet marks the sticky chip bar aria-hidden while the
            // Categories button inside it still holds focus. Blur first, then
            // move focus into the sheet.
            event.preventDefault();
            const active = document.activeElement;
            if (active instanceof HTMLElement) active.blur();
            const root = event.currentTarget;
            if (root instanceof HTMLElement) {
              root.querySelector<HTMLElement>("[role='menuitemradio']")?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>("[data-testid='filter-vote-category-menu']")?.focus();
          }}
        >
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {face}
      <PopoverContent align="start" className="w-72 bg-background p-1">
        <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
          Categories
        </p>
        <OptionList
          options={options}
          value={value}
          onSelect={handleSelect}
          CloseWrapper={PopoverClose}
        />
      </PopoverContent>
    </Popover>
  );
}
