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
import { Filter } from "lucide-react";

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const categories = [
    { value: "all", label: "All Categories" },
    { value: "Music", label: "Music" },
    { value: "Sports", label: "Sports" },
    { value: "Tech", label: "Tech" },
    { value: "Creator", label: "Creator" },
    { value: "Politics", label: "Politics" },
    { value: "Business", label: "Business" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="button-filter">
          <Filter className="h-4 w-4" />
          Filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 z-50">
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
