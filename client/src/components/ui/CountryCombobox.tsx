import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { cn } from "@/lib/utils";
import type { Country } from "@shared/countries";

interface CountryComboboxProps {
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * Searchable country picker with flag icons. The country list is
 * lazy-loaded the first time the popover opens so the ~10 KB ISO
 * table never lands in the initial Settings chunk for users who
 * never edit their country.
 */
export function CountryCombobox({
  value,
  onChange,
  placeholder = "Select country…",
  id,
  className,
  disabled,
  testId,
}: CountryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [countries, setCountries] = useState<ReadonlyArray<Country> | null>(
    null,
  );
  const [searchFn, setSearchFn] = useState<
    ((q: string) => Country[]) | null
  >(null);
  const [byCode, setByCode] = useState<Map<string, Country> | null>(null);

  useEffect(() => {
    if (!open || countries) return;
    let cancelled = false;
    void import("@shared/countries").then((mod) => {
      if (cancelled) return;
      setCountries(mod.COUNTRIES);
      setSearchFn(() => mod.searchCountries);
      setByCode(
        new Map(mod.COUNTRIES.map((c) => [c.code, c] as const)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, countries]);

  const selected = useMemo(() => {
    if (!value) return null;
    if (byCode) return byCode.get(value.toUpperCase()) ?? null;
    return null;
  }, [value, byCode]);

  const results = useMemo(() => {
    if (!countries) return [];
    if (!searchFn || query.trim().length === 0) return [...countries];
    return searchFn(query);
  }, [countries, searchFn, query]);

  const buttonLabel = selected ? (
    <span className="flex items-center gap-2 truncate">
      <CountryFlag code={selected.code} />
      <span className="truncate">{selected.name}</span>
    </span>
  ) : value ? (
    <span className="flex items-center gap-2 truncate text-muted-foreground">
      <CountryFlag code={value} />
      <span className="truncate">{value}</span>
    </span>
  ) : (
    <span className="text-muted-foreground">{placeholder}</span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "w-full justify-between font-normal",
            !selected && !value && "text-muted-foreground",
            className,
          )}
        >
          {buttonLabel}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search countries…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!countries ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading countries…
              </div>
            ) : (
              <>
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {results.map((c) => {
                    const isSelected = selected?.code === c.code;
                    return (
                      <CommandItem
                        key={c.code}
                        value={`${c.name} ${c.code}`}
                        onSelect={() => {
                          onChange(c.code);
                          setOpen(false);
                          setQuery("");
                        }}
                        className="flex items-center gap-2"
                      >
                        <CountryFlag code={c.code} />
                        <span className="flex-1 truncate">{c.name}</span>
                        {isSelected && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
