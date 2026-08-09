import { useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, EyeOff, ListChecks, Vote } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  FILTER_ACTIVE_PILL_WEEKLY,
  FILTER_ACTIVE_PILL_WORLD,
} from "@/lib/filterControlStyles";
import {
  HUB_ACTIVITY_FILTER_VALUES,
  hubActivityFilterMenuLabel,
  hubActivityFilterMenuTitle,
  hubActivityFilterPillLabel,
  type HubActivityFilter,
  type HubActivityFilterScope,
} from "@/lib/hub-activity-filter";
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

const FILTER_ACTIVE_PILL_VOTE =
  "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20";

const FILTER_ACTIVE_PILL_HIDE =
  "bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/50 dark:border-amber-500/40";

const FILTER_INACTIVE_PILL =
  "bg-background text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/5 border border-border/60";

export type HubActivityFilterAccent = "vote" | "weekly" | "world";

interface HubActivityFilterControlProps {
  scope: HubActivityFilterScope;
  value: HubActivityFilter;
  count: number;
  onChange: (value: HubActivityFilter) => void;
  accent?: HubActivityFilterAccent;
  shrink?: boolean;
  className?: string;
  "data-testid"?: string;
}

function ScopeIcon({
  scope,
  value,
  className,
}: {
  scope: HubActivityFilterScope;
  value: HubActivityFilter;
  className?: string;
}) {
  if (value === "hide-mine") {
    return <EyeOff className={className} />;
  }
  if (scope === "vote") {
    return <Vote className={className} />;
  }
  return <ListChecks className={className} />;
}

function OptionList({
  scope,
  value,
  onSelect,
  CloseWrapper,
  testId,
}: {
  scope: HubActivityFilterScope;
  value: HubActivityFilter;
  onSelect: (next: HubActivityFilter) => void;
  CloseWrapper: ComponentType<{ children: ReactNode; asChild?: boolean }>;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 py-1" role="menu">
      {HUB_ACTIVITY_FILTER_VALUES.map((option) => {
        const selected = option === value;
        return (
          <CloseWrapper key={option} asChild>
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
              onClick={() => onSelect(option)}
              data-testid={testId ? `${testId}-option-${option}` : undefined}
            >
              <ScopeIcon
                scope={scope}
                value={option}
                className="h-4 w-4 opacity-60 shrink-0"
              />
              <span className="flex-1 min-w-0 leading-snug">
                {hubActivityFilterMenuLabel(scope, option)}
              </span>
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

function activePillClass(accent: HubActivityFilterAccent): string {
  if (accent === "weekly") return FILTER_ACTIVE_PILL_WEEKLY;
  if (accent === "world") return FILTER_ACTIVE_PILL_WORLD;
  return FILTER_ACTIVE_PILL_VOTE;
}

export function HubActivityFilterControl({
  scope,
  value,
  count,
  onChange,
  accent = scope === "vote" ? "vote" : "world",
  shrink,
  className,
  "data-testid": testId = scope === "vote" ? "toggle-my-votes-pill" : "toggle-my-positions-pill",
}: HubActivityFilterControlProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const menuTitle = hubActivityFilterMenuTitle(scope);
  const pillLabel = hubActivityFilterPillLabel(scope, value, count);

  const handleSelect = (next: HubActivityFilter) => {
    onChange(next);
    setOpen(false);
  };

  const pillButton = (
    <button
      type="button"
      aria-label={`${menuTitle}: ${pillLabel}`}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        shrink && "shrink-0",
        value === "show-mine"
          ? activePillClass(accent)
          : value === "hide-mine"
            ? FILTER_ACTIVE_PILL_HIDE
            : FILTER_INACTIVE_PILL,
        className,
      )}
      data-testid={testId}
    >
      <ScopeIcon scope={scope} value={value} className="h-4 w-4 shrink-0" />
      <span>{pillLabel}</span>
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 opacity-70 transition-transform",
          open && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{pillButton}</DrawerTrigger>
        <DrawerContent>
          <div className="px-2 pb-4">
            <DrawerTitle className="px-3 pt-1 pb-2 text-sm font-semibold text-foreground text-left">
              {menuTitle}
            </DrawerTitle>
            <OptionList
              scope={scope}
              value={value}
              onSelect={handleSelect}
              CloseWrapper={DrawerClose}
              testId={testId}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{pillButton}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
          {menuTitle}
        </p>
        <OptionList
          scope={scope}
          value={value}
          onSelect={handleSelect}
          CloseWrapper={PopoverClose}
          testId={testId}
        />
      </PopoverContent>
    </Popover>
  );
}
