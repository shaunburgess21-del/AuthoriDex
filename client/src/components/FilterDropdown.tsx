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
import { SlidersHorizontal } from "lucide-react";

const DEFAULT_CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "favorites", label: "Favorites" },
  { value: "trending", label: "Trending" },
  { value: "Tech", label: "Tech" },
  { value: "Politics", label: "Politics" },
  { value: "Business", label: "Business" },
  { value: "Music", label: "Music" },
  { value: "Sports", label: "Sports" },
  { value: "Creator", label: "Creator" },
];

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
  categories?: { value: string; label: string }[];
  allValue?: string;
  testId?: string;
}

export function FilterDropdown({ value, onChange, categories = DEFAULT_CATEGORIES, allValue = "all", testId = "button-filter" }: FilterDropdownProps) {
  const isFiltered = value.toLowerCase() !== allValue.toLowerCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className={`shrink-0 ${isFiltered ? "border-primary/50 text-primary" : ""}`} data-testid={testId}>
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 z-[60]">
        <DropdownMenuLabel>Category</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {categories.map((category) => (
            <DropdownMenuRadioItem 
              key={category.value} 
              value={category.value}
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
