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

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const isFiltered = value !== "all";
  const categories = [
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className={`shrink-0 ${isFiltered ? "border-primary/50 text-primary" : ""}`} data-testid="button-filter">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 z-50">
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
