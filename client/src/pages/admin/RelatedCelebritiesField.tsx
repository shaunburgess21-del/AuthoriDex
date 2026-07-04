import { useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Display on Profiles" multi-select used by the admin market / poll /
 * matchup modals. Extracted from AdminDashboard.tsx (Phase 3+4 B6) so
 * CreateMarketModal could move to its own file without a circular import.
 */
export function RelatedCelebritiesField({
  value,
  onChange,
  fetchFn,
}: {
  value: { id: string; name: string }[];
  onChange: (people: { id: string; name: string }[]) => void;
  fetchFn: (url: string, opts?: any) => Promise<Response>;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    try {
      const res = await fetchFn(`/api/admin/celebrities?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const selectedIds = new Set(value.map(p => p.id));
        setResults(data.filter((c: any) => !selectedIds.has(c.id)).slice(0, 8));
        setShowDropdown(true);
      }
    } catch {}
  }, [fetchFn, value]);

  const handleChange = (val: string) => {
    setSearch(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(val), 300);
  };

  const select = (celeb: any) => {
    onChange([...value, { id: celeb.id, name: celeb.name }]);
    setSearch("");
    setResults([]);
    setShowDropdown(false);
  };

  const remove = (id: string) => {
    onChange(value.filter(p => p.id !== id));
  };

  return (
    <div className="space-y-2 relative min-w-0 max-w-full">
      <Label className="text-xs text-muted-foreground">Display on Profiles (optional)</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
              {p.name}
              <button type="button" className="hover:text-destructive" onClick={() => remove(p.id)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={search}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
        onBlur={() => { setTimeout(() => setShowDropdown(false), 200); }}
        placeholder="Search celebrities to add..."
        className="h-8 text-sm"
      />
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
          {results.map((c: any) => (
            <button
              key={c.id}
              type="button"
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent/50 flex items-center gap-2"
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">{c.category}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Select celebrities whose profile pages should show this card</p>
    </div>
  );
}
