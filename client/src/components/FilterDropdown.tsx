import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { CATEGORY_FILTER_SELECT_OPTIONS } from "@shared/constants";

const DEFAULT_CATEGORIES = CATEGORY_FILTER_SELECT_OPTIONS;

export type SortDirection = "desc" | "asc";

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
  categories?: { value: string; label: string }[];
  allValue?: string;
  testId?: string;
  sortDirection?: SortDirection;
  onSortDirectionChange?: (direction: SortDirection) => void;
  /** When set, overrides the default category-only active styling. */
  isActive?: boolean;
}

export function FilterDropdown({
  value,
  onChange,
  categories = DEFAULT_CATEGORIES,
  allValue = "all",
  testId = "button-filter",
  sortDirection,
  onSortDirectionChange,
  isActive,
}: FilterDropdownProps) {
  const isFiltered = isActive ?? value.toLowerCase() !== allValue.toLowerCase();
  const showSortSection = sortDirection !== undefined && onSortDirectionChange !== undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className={`shrink-0 ${isFiltered ? "border-primary/50 text-primary" : ""}`} data-testid={testId}>
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 z-[60]">
        {showSortSection && (
          <>
            <DropdownMenuLabel>Sort</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sortDirection}
              onValueChange={(v) => onSortDirectionChange?.(v as SortDirection)}
            >
              <DropdownMenuRadioItem value="desc" indicator="none" data-testid="sort-desc">
                <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                High to low
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="asc" indicator="none" data-testid="sort-asc">
                <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                Low to high
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{showSortSection ? "Categories" : "Category"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {categories.map((category) => (
            <DropdownMenuRadioItem
              key={category.value}
              value={category.value}
              indicator="none"
              data-testid={`filter-${category.value}`}
            >
              {category.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
