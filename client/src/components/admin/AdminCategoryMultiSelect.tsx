import { useMemo } from "react";
import { Check, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeMarketCategory } from "@shared/constants";

export interface AdminCategoryOption {
  value: string;
  label: string;
}

interface AdminCategoryMultiSelectProps {
  /** Registry-backed category options ({ value: id, label }). */
  options: AdminCategoryOption[];
  /** Currently selected secondary category ids. */
  value: string[];
  onChange: (next: string[]) => void;
  /** The primary category (id or Title Case). Excluded from selection. */
  primaryValue?: string | null;
  label?: string;
  helperText?: string;
  testId?: string;
}

/**
 * Reusable multi-select for secondary category labels. Stores canonical
 * kebab ids. The primary category is excluded so it can't be duplicated as a
 * secondary. Display pills elsewhere always show the primary only — this
 * control just widens which filters an item appears under.
 */
export function AdminCategoryMultiSelect({
  options,
  value,
  onChange,
  primaryValue,
  label = "Secondary Categories",
  helperText = "Also show this under these category filters (optional). The displayed label stays the primary category.",
  testId,
}: AdminCategoryMultiSelectProps) {
  const primaryId = normalizeMarketCategory(primaryValue ?? "");
  const selected = useMemo(
    () => new Set((value ?? []).map((v) => normalizeMarketCategory(v)).filter(Boolean)),
    [value],
  );

  const selectableOptions = useMemo(
    () => options.filter((o) => o.value && o.value !== primaryId),
    [options, primaryId],
  );

  const labelFor = (id: string) =>
    options.find((o) => o.value === id)?.label ?? id;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const remove = (id: string) => {
    onChange(Array.from(selected).filter((s) => s !== id));
  };

  const selectedIds = Array.from(selected);

  return (
    <div className="space-y-2" data-testid={testId}>
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
            data-testid={testId ? `${testId}-trigger` : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "Add secondary categories"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start">
          <div className="max-h-64 overflow-y-auto p-1">
            {selectableOptions.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No categories available.
              </p>
            ) : (
              selectableOptions.map((o) => {
                const isChecked = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                      isChecked && "font-medium",
                    )}
                    data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                  >
                    <span>{o.label}</span>
                    {isChecked && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {labelFor(id)}
              <button
                type="button"
                onClick={() => remove(id)}
                className="ml-0.5 rounded-full hover:text-destructive"
                aria-label={`Remove ${labelFor(id)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}
