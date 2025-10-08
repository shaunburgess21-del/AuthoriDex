import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState } from "react";

interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder = "Search people..." }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch?.(value);
  };

  return (
    <div className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        className="pl-10"
        data-testid="input-search"
      />
    </div>
  );
}
