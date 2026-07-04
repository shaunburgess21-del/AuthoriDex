import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Globe, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CountryFlag } from "@/components/ui/CountryFlag";
import { cn } from "@/lib/utils";
import type { Country } from "@shared/countries";

export interface GeoCountryTargetingProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  selectedCodes: string[];
  onSelectedCodesChange: (codes: string[]) => void;
  className?: string;
  testIdPrefix?: string;
}

export function isGeoTargetingValid(enabled: boolean, selectedCodes: string[]): boolean {
  if (!enabled) return true;
  return selectedCodes.length > 0;
}

/**
 * Toggle + multi-select for limiting card visibility by country of residence.
 * When disabled, callers should persist an empty allowlist (global visibility).
 */
export function GeoCountryTargeting({
  enabled,
  onEnabledChange,
  selectedCodes,
  onSelectedCodesChange,
  className,
  testIdPrefix = "geo",
}: GeoCountryTargetingProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [countries, setCountries] = useState<ReadonlyArray<Country> | null>(null);
  const [searchFn, setSearchFn] = useState<((q: string) => Country[]) | null>(null);
  const [byCode, setByCode] = useState<Map<string, Country> | null>(null);

  useEffect(() => {
    if (!enabled || countries) return;
    let cancelled = false;
    void import("@shared/countries").then((mod) => {
      if (cancelled) return;
      setCountries(mod.COUNTRIES);
      setSearchFn(() => mod.searchCountries);
      setByCode(new Map(mod.COUNTRIES.map((c) => [c.code, c] as const)));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, countries]);

  const selectedSet = useMemo(
    () => new Set(selectedCodes.map((c) => c.toUpperCase())),
    [selectedCodes],
  );

  const results = useMemo(() => {
    if (!countries) return [];
    if (!searchFn || query.trim().length === 0) return [...countries];
    return searchFn(query);
  }, [countries, searchFn, query]);

  const toggleCountry = (code: string) => {
    const upper = code.toUpperCase();
    if (selectedSet.has(upper)) {
      onSelectedCodesChange(selectedCodes.filter((c) => c.toUpperCase() !== upper));
    } else {
      onSelectedCodesChange([...selectedCodes, upper]);
    }
  };

  const removeCountry = (code: string) => {
    const upper = code.toUpperCase();
    onSelectedCodesChange(selectedCodes.filter((c) => c.toUpperCase() !== upper));
  };

  return (
    <div className={cn("space-y-3 rounded-lg border border-border/60 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Limit visibility by country
          </Label>
          <p className="text-xs text-muted-foreground">
            Only users based in selected countries will see this card.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            onEnabledChange(checked);
            if (!checked) onSelectedCodesChange([]);
          }}
          data-testid={`${testIdPrefix}-geo-toggle`}
        />
      </div>

      {enabled && (
        <div className="space-y-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between font-normal"
                data-testid={`${testIdPrefix}-geo-country-picker`}
              >
                <span className="text-muted-foreground">
                  {selectedCodes.length === 0
                    ? "Select at least one country…"
                    : `${selectedCodes.length} countr${selectedCodes.length === 1 ? "y" : "ies"} selected`}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
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
                          const isSelected = selectedSet.has(c.code);
                          return (
                            <CommandItem
                              key={c.code}
                              value={`${c.name} ${c.code}`}
                              onSelect={() => toggleCountry(c.code)}
                              className="flex items-center gap-2"
                            >
                              <CountryFlag code={c.code} />
                              <span className="flex-1 truncate">{c.name}</span>
                              {isSelected && <Check className="h-4 w-4 text-primary" />}
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

          {selectedCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedCodes.map((code) => {
                const name = byCode?.get(code.toUpperCase())?.name ?? code;
                return (
                  <Badge
                    key={code}
                    variant="secondary"
                    className="gap-1 pr-1 font-normal"
                  >
                    <CountryFlag code={code} className="h-3 w-3" />
                    {name}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 hover:bg-muted"
                      onClick={() => removeCountry(code)}
                      aria-label={`Remove ${name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          {selectedCodes.length === 0 && (
            <p className="text-xs text-destructive">Select at least one country.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Derive toggle + codes from a stored allowlist (edit flows). */
export function geoStateFromAllowlist(allowlist: string[] | null | undefined): {
  enabled: boolean;
  codes: string[];
} {
  const codes = (allowlist ?? []).map((c) => c.toUpperCase());
  return { enabled: codes.length > 0, codes };
}

/** Payload field for create/update APIs. */
export function visibleCountriesPayload(
  enabled: boolean,
  selectedCodes: string[],
): string[] {
  return enabled ? selectedCodes.map((c) => c.toUpperCase()) : [];
}
