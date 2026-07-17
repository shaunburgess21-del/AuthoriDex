import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { apiRequest } from "@/lib/queryClient";

export interface PersonResult {
  id: string;
  name: string;
  avatar: string | null;
}

interface PersonSearchPopoverProps {
  trigger: ReactNode;
  /** Ids to hide from results (already selected). */
  excludeIds?: string[];
  onSelect: (person: PersonResult) => void;
  /** Close after selecting (single-select use). */
  closeOnSelect?: boolean;
  align?: "start" | "center" | "end";
  placeholder?: string;
  /** Optional muted explanation above the search field. */
  hint?: string;
  /** Notified when the popover opens/closes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Server-backed celebrity typeahead in a popover. cmdk's internal filtering is
 * disabled (`shouldFilter={false}`) because results come from
 * `/api/people/search`.
 */
export function PersonSearchPopover({
  trigger,
  excludeIds = [],
  onSelect,
  closeOnSelect = false,
  align = "start",
  placeholder = "Search celebrities…",
  hint,
  onOpenChange,
}: PersonSearchPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching } = useQuery<PersonResult[]>({
    queryKey: ["/api/people/search", "voices", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/people/search?q=${encodeURIComponent(debounced)}&limit=12`);
      const json = (await res.json()) as { data?: PersonResult[] };
      return json.data ?? [];
    },
    staleTime: 60_000,
  });

  const visible = useMemo(
    () => results.filter((r) => !excludeIds.includes(r.id)),
    [results, excludeIds],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align={align}>
        <Command shouldFilter={false}>
          {hint ? (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">{hint}</p>
          ) : null}
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              data-testid="person-search-input"
            />
          </div>
          <CommandList>
            {debounced.length < 2 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Type at least 2 characters.</p>
            ) : isFetching ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Searching…</p>
            ) : visible.length === 0 ? (
              <CommandEmpty>No celebrities found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {visible.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onSelect(p);
                      setQuery("");
                      if (closeOnSelect) handleOpenChange(false);
                    }}
                    className="gap-2"
                  >
                    {p.avatar ? (
                      <img src={p.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px]">
                        {p.name.charAt(0)}
                      </span>
                    )}
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
