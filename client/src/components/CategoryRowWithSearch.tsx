import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { FILTER_ROW_SEARCH_INPUT } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";

interface CategoryRowWithSearchProps {
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}

export function CategoryRowWithSearch({
  children,
  searchValue,
  onSearchChange,
  placeholder = "Search...",
  testId,
}: CategoryRowWithSearchProps) {
  return (
    <div className="flex items-center gap-3">
      <ScrollMaskedChipRow className="flex-1 min-w-0">
        {children}
      </ScrollMaskedChipRow>
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
    </div>
  );
}
