/**
 * Step 3 — Country of residence.
 *
 * Inline searchable list. Unlike the Settings CountryCombobox (which
 * is a popover trigger), this is the entire step — the search box
 * sits at the top, results stream below, and the user taps a row to
 * select. Selecting auto-stages the value; the container's Continue
 * button submits.
 *
 * The country table is loaded eagerly here because the whole step is
 * dedicated to it; lazy-loading would just produce a flicker.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { COUNTRIES, searchCountries, type Country } from "@shared/countries";
import { cn } from "@/lib/utils";

interface CountryListProps {
  value: string | null;
  onChange: (code: string) => void;
}

export function CountryList({ value, onChange }: CountryListProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the search box on mount so users can start typing
  // immediately. Skipped on touch devices where focusing would yank
  // up the soft keyboard before the user has chosen to engage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouch =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (isTouch) return;
    inputRef.current?.focus();
  }, []);

  const results = useMemo<ReadonlyArray<Country>>(() => {
    const q = query.trim();
    if (q.length === 0) {
      return COUNTRIES;
    }
    return searchCountries(q);
  }, [query]);

  const selectedCode = value ? value.toUpperCase() : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="country-name"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search countries"
          aria-label="Search countries"
          data-testid="country-search"
          className="h-12 w-full rounded-2xl border border-border/60 bg-card/40 pl-11 pr-4 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:bg-card/70"
        />
      </div>

      <div
        role="listbox"
        aria-label="Country of residence"
        className="scrollbar-hide -mx-1 max-h-[50vh] flex-1 overflow-y-auto rounded-xl px-1"
        data-testid="country-list"
      >
        {results.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No matches for "{query.trim()}".
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {results.map((c) => {
              const isSelected = selectedCode === c.code;
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onChange(c.code)}
                    data-testid={`country-option-${c.code}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 active:scale-[0.99]",
                      isSelected
                        ? "border-primary/60 bg-primary/10"
                        : "border-transparent hover:border-border/60 hover:bg-card/50",
                    )}
                  >
                    <CountryFlag
                      code={c.code}
                      className="h-4 w-6 flex-shrink-0"
                      title={c.name}
                    />
                    <span className="flex-1 truncate text-base font-medium">
                      {c.name}
                    </span>
                    {isSelected ? (
                      <Check
                        aria-hidden="true"
                        className="h-4 w-4 flex-shrink-0 text-primary"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
