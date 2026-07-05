import { useState } from "react";
import { Check, Filter, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATEGORY_CHIP_RADIUS } from "@/lib/filterControlStyles";
import {
  VOICES_SURFACES,
  VOICES_SURFACE_LABELS,
  CANONICAL_CATEGORIES,
  type VoicesSurface,
} from "@shared/constants";
import { PersonSearchPopover, type PersonResult } from "./PersonSearchPopover";
import type { VoicesFeedMode, VoicesFilters } from "./types";

const MODES: Array<{ id: VoicesFeedMode; label: string }> = [
  { id: "for-you", label: "For You" },
  { id: "latest", label: "Latest" },
  { id: "top", label: "Top" },
];

interface VoicesFilterBarProps {
  filters: VoicesFilters;
  onChange: (next: VoicesFilters) => void;
  mode: VoicesFeedMode;
  onModeChange: (mode: VoicesFeedMode) => void;
}

export function VoicesFilterBar({
  filters,
  onChange,
  mode,
  onModeChange,
}: VoicesFilterBarProps) {
  // Remember names for selected people so we can render removable badges.
  const [personNames, setPersonNames] = useState<Record<string, string>>({});

  const activeCount =
    filters.surfaces.length + filters.personIds.length + filters.categories.length;

  const toggleSurface = (s: VoicesSurface) => {
    const next = filters.surfaces.includes(s)
      ? filters.surfaces.filter((x) => x !== s)
      : [...filters.surfaces, s];
    onChange({ ...filters, surfaces: next });
  };

  const toggleCategory = (id: string) => {
    const next = filters.categories.includes(id)
      ? filters.categories.filter((x) => x !== id)
      : [...filters.categories, id];
    onChange({ ...filters, categories: next });
  };

  const addPerson = (p: PersonResult) => {
    if (filters.personIds.includes(p.id)) return;
    setPersonNames((m) => ({ ...m, [p.id]: p.name }));
    onChange({ ...filters, personIds: [...filters.personIds, p.id] });
  };

  const removePerson = (id: string) => {
    onChange({ ...filters, personIds: filters.personIds.filter((x) => x !== id) });
  };

  const clearAll = () => onChange({ surfaces: [], personIds: [], categories: [] });

  return (
    <div className="space-y-2" data-testid="voices-filter-bar">
      {/* Entity filters + feed mode tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex shrink-0 items-center gap-2">
          <PersonSearchPopover
            excludeIds={filters.personIds}
            onSelect={addPerson}
            closeOnSelect
            trigger={
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 font-normal">
                <Filter className="h-3.5 w-3.5" />
                Celebrities
                {filters.personIds.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    {filters.personIds.length}
                  </span>
                )}
              </Button>
            }
          />

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 font-normal">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Categories
                {filters.categories.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    {filters.categories.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[230px] p-1" align="start">
              <div
                className="max-h-64 overflow-y-auto"
                onWheel={(e) => {
                  e.currentTarget.scrollTop += e.deltaY;
                  e.stopPropagation();
                }}
              >
                {CANONICAL_CATEGORIES.map((c) => {
                  const checked = filters.categories.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                        checked && "font-medium",
                      )}
                      data-testid={`voices-category-${c.id}`}
                    >
                      <span>{c.label}</span>
                      {checked && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={clearAll}
              data-testid="voices-clear-filters"
            >
              Clear
            </Button>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  mode === m.id
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`voices-mode-${m.id}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Surface pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {VOICES_SURFACES.map((s) => {
          const active = filters.surfaces.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleSurface(s)}
              className={cn(
                "shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors",
                CATEGORY_CHIP_RADIUS,
                active
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
              data-testid={`voices-surface-${s}`}
            >
              {VOICES_SURFACE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {/* Selected celebrity + category chips */}
      {(filters.personIds.length > 0 || filters.categories.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {filters.personIds.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {personNames[id] ?? "Celebrity"}
              <button
                type="button"
                onClick={() => removePerson(id)}
                className="ml-0.5 rounded-full hover:text-destructive"
                aria-label="Remove celebrity filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.categories.map((id) => {
            const label = CANONICAL_CATEGORIES.find((c) => c.id === id)?.label ?? id;
            return (
              <Badge key={id} variant="outline" className="gap-1">
                {label}
                <button
                  type="button"
                  onClick={() => toggleCategory(id)}
                  className="ml-0.5 rounded-full hover:text-destructive"
                  aria-label="Remove category filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
