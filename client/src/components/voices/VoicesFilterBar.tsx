import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { apiRequest } from "@/lib/queryClient";
import { CATEGORY_CHIP_RADIUS } from "@/lib/filterControlStyles";
import { CANONICAL_CATEGORIES } from "@shared/constants";
import { cn } from "@/lib/utils";
import { resetIosInputZoom } from "@/components/quick-vote/QuickVoteSearch";
import type { PersonResult } from "./PersonSearchPopover";
import type { VoicesFeedMode, VoicesFilters } from "./types";
import { EMPTY_VOICES_FILTERS } from "./types";
import {
  VOICES_POST_TYPE_TOGGLES,
  activePostTypeToggles,
  categoryFilterLabel,
  countActiveVoiceFilters,
  favouritePersonIds,
  favouritesSelectionActive,
  postTypeIsOn,
  postTypeToggleById,
  togglePostType,
  voiceFilterPersonSlots,
  voicesFilterButtonLabel,
  voicesSheetKeyboardOffset,
  withoutPostType,
} from "./voicesFilters";

const MODES: Array<{ id: VoicesFeedMode; label: string }> = [
  { id: "for-you", label: "For You" },
  { id: "latest", label: "Latest" },
  { id: "top", label: "Top" },
];

/** Same paint for For You / Latest / Top and the Favourites toggle. */
function modeTabClass(active: boolean): string {
  return cn(
    "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap border px-1 text-xs font-medium transition-colors min-[360px]:px-1.5 min-[400px]:px-2 sm:px-3",
    CATEGORY_CHIP_RADIUS,
    active
      ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

interface VoicesFilterBarProps {
  filters: VoicesFilters;
  onChange: (next: VoicesFilters) => void;
  mode: VoicesFeedMode;
  onModeChange: (mode: VoicesFeedMode) => void;
  personNames: Record<string, string>;
  onPersonResolved: (person: { id: string; name: string }) => void;
  showFavourites: boolean;
  favouriteIds: readonly string[];
  /** Signed-in favourites request still in flight — avoid a flash of one chip per id. */
  favouritesResolving?: boolean;
  onToggleFavourites: () => void;
  /**
   * True while the mobile sheet is open. The page defers history pushes
   * until the sheet closes so celebrity search and in-sheet toggles share
   * one entry. Desktop stays false and commits each change.
   */
  onHistoryDeferChange?: (defer: boolean) => void;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function useSheetFrame(open: boolean) {
  const [frame, setFrame] = useState(() =>
    voicesSheetKeyboardOffset({
      innerHeight: typeof window !== "undefined" ? window.innerHeight : 800,
      viewportHeight: typeof window !== "undefined" ? window.innerHeight : 800,
      viewportOffsetTop: 0,
    }),
  );
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const measure = () => {
      const vv = window.visualViewport;
      const next = voicesSheetKeyboardOffset({
        innerHeight: window.innerHeight,
        viewportHeight: vv?.height ?? window.innerHeight,
        viewportOffsetTop: vv?.offsetTop ?? 0,
      });
      setFrame((prev) =>
        prev.bottom === next.bottom && prev.maxHeight === next.maxHeight ? prev : next,
      );
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open]);
  return frame;
}

/**
 * Desktop panel position. Re-pins under the site header when the Voices
 * sub-header translates away on scroll. Scroll updates position only — it
 * does not close the panel.
 */
function usePinnedPanelStyle(
  open: boolean,
  anchorRef: RefObject<HTMLButtonElement>,
) {
  const [style, setStyle] = useState<{ top: number; left: number; maxHeight: number }>({
    top: 72,
    left: 16,
    maxHeight: 480,
  });
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      const width = 320;
      const vw = window.innerWidth;
      const headerBottom = 64;
      const rect = el?.getBoundingClientRect();
      const triggerVisible = !!rect && rect.bottom > headerBottom + 4 && rect.top < window.innerHeight - 8;
      const top = triggerVisible && rect ? rect.bottom + 8 : headerBottom + 8;
      let left = triggerVisible && rect ? rect.right - width : vw - width - 16;
      left = Math.max(8, Math.min(left, vw - width - 8));
      const maxHeight = Math.max(240, window.innerHeight - top - 16);
      setStyle((prev) =>
        prev.top === top && prev.left === left && prev.maxHeight === maxHeight
          ? prev
          : { top, left, maxHeight },
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);
  return style;
}

function scrollFieldIntoSheet(field: HTMLElement) {
  const scroller = field.closest("[data-voices-filter-scroller]");
  if (!(scroller instanceof HTMLElement)) return;
  const delta = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
  scroller.scrollTop += delta;
}

function CelebritySearch({
  excludeIds,
  onSelect,
}: {
  excludeIds: readonly string[];
  onSelect: (person: PersonResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data: results = [], isFetching } = useQuery<PersonResult[]>({
    queryKey: ["/api/people/search", "voices", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/people/search?q=${encodeURIComponent(debounced)}&limit=12`);
      const json = (await res.json()) as { data?: PersonResult[] };
      return json.data ?? [];
    },
    staleTime: 60_000,
  });

  const visible = useMemo(
    () => results.filter((person) => !excludeIds.includes(person.id)),
    [results, excludeIds],
  );

  return (
    <div>
      <div className="flex items-center rounded-md border px-3">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={(event) => {
            const field = event.currentTarget;
            window.setTimeout(() => scrollFieldIntoSheet(field), 50);
            window.setTimeout(() => scrollFieldIntoSheet(field), 320);
          }}
          onBlur={() => resetIosInputZoom()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visible[0]) {
              event.preventDefault();
              onSelect(visible[0]);
              setQuery("");
            }
          }}
          placeholder="Search celebrities…"
          aria-label="Search celebrities"
          enterKeyHint="search"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="voices-celebrity-search"
          className="h-11 w-full bg-transparent py-2 text-[16px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {debounced.length >= 2 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border">
          {isFetching ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No celebrities found.</p>
          ) : (
            visible.map((person) => (
              <button
                key={person.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect(person);
                  setQuery("");
                }}
              >
                {person.avatar ? (
                  <img src={person.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px]">
                    {person.name.charAt(0)}
                  </span>
                )}
                <span className="truncate">{person.name}</span>
              </button>
            ))
          )}
        </div>
      )}
      {query.trim().length > 0 && debounced.length < 2 && (
        <p className="px-1 py-2 text-xs text-muted-foreground">Type at least 2 characters.</p>
      )}
    </div>
  );
}

export function VoicesFilterBar({
  filters,
  onChange,
  mode,
  onModeChange,
  personNames,
  onPersonResolved,
  showFavourites,
  favouriteIds,
  favouritesResolving = false,
  onToggleFavourites,
  onHistoryDeferChange,
}: VoicesFilterBarProps) {
  const [open, setOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetFrame = useSheetFrame(open && mobile);
  const pinned = usePinnedPanelStyle(open && !mobile, buttonRef);
  useEffect(() => {
    onHistoryDeferChange?.(open && mobile);
  }, [open, mobile, onHistoryDeferChange]);
  const registry = useCategoryRegistry();

  const registryLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of registry.categories) {
      if (row.id && row.label) map.set(row.id, row.label);
    }
    return map;
  }, [registry.categories]);

  const categoryOptions = useMemo(
    () =>
      registry.isReady && registry.categories.length > 0
        ? registry.categories.map((category) => ({ id: category.id, label: category.label }))
        : CANONICAL_CATEGORIES.map((category) => ({ id: category.id, label: category.label })),
    [registry.isReady, registry.categories],
  );

  const favouritesActive = favouritesSelectionActive(filters.personIds, favouriteIds);
  const hiddenPeople = useMemo(() => {
    if (!favouritesActive) return new Set<string>();
    return new Set(favouritePersonIds(favouriteIds));
  }, [favouritesActive, favouriteIds]);

  const personCount =
    favouritesResolving && filters.personIds.length > 1
      ? 1
      : voiceFilterPersonSlots(filters.personIds, favouriteIds);
  const count = countActiveVoiceFilters(filters, { personCount });
  const postTypeChips = activePostTypeToggles(filters.surfaces);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleCategory = (id: string) => {
    const next = filters.categories.includes(id)
      ? filters.categories.filter((category) => category !== id)
      : [...filters.categories, id];
    onChange({ ...filters, categories: next });
  };

  const addPerson = (person: PersonResult) => {
    onPersonResolved({ id: person.id, name: person.name });
    if (filters.personIds.includes(person.id)) return;
    onChange({ ...filters, personIds: [...filters.personIds, person.id] });
  };

  const removePerson = (id: string) => {
    onChange({ ...filters, personIds: filters.personIds.filter((personId) => personId !== id) });
  };

  const clearAll = () => onChange(EMPTY_VOICES_FILTERS);

  const visiblePeople = favouritesResolving
    ? []
    : filters.personIds.filter((id) => !hiddenPeople.has(id));

  const fields = (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Post type</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Post type">
          {VOICES_POST_TYPE_TOGGLES.map((toggle) => {
            const on = postTypeIsOn(filters.surfaces, toggle.surfaces);
            return (
              <button
                key={toggle.id}
                type="button"
                aria-pressed={on}
                data-testid={toggle.testId}
                onClick={() => {
                  const known = postTypeToggleById(toggle.id) ?? toggle;
                  onChange({
                    ...filters,
                    surfaces: togglePostType(filters.surfaces, known.surfaces),
                  });
                }}
                className={cn(
                  "border px-3 py-1.5 text-xs font-medium transition-colors",
                  CATEGORY_CHIP_RADIUS,
                  on
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {toggle.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Celebrities</p>
        {showFavourites && (
          <button
            type="button"
            onClick={onToggleFavourites}
            aria-pressed={favouritesActive}
            data-testid="voices-favourites-panel"
            className={cn(
              "mb-2 inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium",
              CATEGORY_CHIP_RADIUS,
              favouritesActive
                ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", favouritesActive && "fill-current")} />
            Favorites
          </button>
        )}
        <CelebritySearch excludeIds={filters.personIds} onSelect={addPerson} />
        {visiblePeople.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visiblePeople.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1 font-normal">
                {personNames[id] ?? "Celebrity"}
                <button
                  type="button"
                  onClick={() => removePerson(id)}
                  className="ml-0.5 rounded-full hover:text-destructive"
                  aria-label={`Remove ${personNames[id] ?? "celebrity"} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Categories</p>
        <div className="space-y-0.5">
          {categoryOptions.map((category) => {
            const checked = filters.categories.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  checked && "font-medium",
                )}
                data-testid={`voices-category-${category.id}`}
              >
                <span>{category.label}</span>
                {checked && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const footer = (
    <div className="flex items-center gap-2 border-t p-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
        onClick={clearAll}
        disabled={count === 0}
        data-testid="voices-clear-filters"
      >
        Clear all
      </Button>
      {mobile && (
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          onClick={() => setOpen(false)}
          data-testid="voices-show-results"
        >
          Show results
        </Button>
      )}
    </div>
  );

  const panel = open
    ? createPortal(
        <>
          {mobile && (
            <div
              className="fixed inset-0 z-[70] bg-black/50"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            ref={panelRef}
            id="voices-filter-panel"
            role="dialog"
            aria-modal={mobile}
            aria-label="Filter voices"
            data-testid="voices-filter-panel"
            data-voices-filter-portal="true"
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              "z-[80] flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-lg",
              mobile ? "fixed inset-x-0 rounded-t-2xl" : "fixed w-80 rounded-xl",
            )}
            style={
              mobile
                ? {
                    bottom: sheetFrame.bottom,
                    maxHeight: sheetFrame.maxHeight,
                    paddingBottom: "env(safe-area-inset-bottom, 0px)",
                  }
                : {
                    top: pinned.top,
                    left: pinned.left,
                    maxHeight: pinned.maxHeight,
                  }
            }
          >
            {mobile && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" />}
            <div className="flex items-center justify-between px-3 pt-3">
              <h2 className="text-sm font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
              data-voices-filter-scroller=""
            >
              {fields}
            </div>
            {footer}
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <div className="space-y-2" data-testid="voices-filter-bar">
      <div className="flex flex-nowrap items-center gap-1 sm:gap-2" data-testid="voices-mode-row">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] min-[400px]:gap-1 [&::-webkit-scrollbar]:hidden">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onModeChange(item.id)}
              className={modeTabClass(mode === item.id)}
              data-testid={`voices-mode-${item.id}`}
            >
              {item.label}
            </button>
          ))}
          {showFavourites && (
            <button
              type="button"
              onClick={onToggleFavourites}
              aria-pressed={favouritesActive}
              data-testid="voices-favourites-chip"
              className={modeTabClass(favouritesActive)}
            >
              <Star className={cn("h-3 w-3 shrink-0", favouritesActive && "fill-current")} />
              Favorites
            </button>
          )}
        </div>
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 shrink-0 gap-1 px-2 font-normal sm:gap-1.5 sm:px-3",
            count > 0 && "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
          )}
          aria-expanded={open}
          aria-controls="voices-filter-panel"
          aria-label={voicesFilterButtonLabel(count)}
          onClick={() => setOpen((value) => !value)}
          data-testid="voices-filter-button"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{voicesFilterButtonLabel(count)}</span>
          {count > 0 && (
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/25 px-1 text-[10px] font-semibold leading-none sm:hidden"
              data-testid="voices-filter-count"
            >
              {count}
            </span>
          )}
        </Button>
      </div>

      {(postTypeChips.length > 0 || visiblePeople.length > 0 || filters.categories.length > 0) && (
        <div className="flex flex-wrap gap-1.5" data-testid="voices-active-filters">
          {postTypeChips.map((toggle) => (
            <Badge key={toggle.id} variant="secondary" className="gap-1 font-normal" data-testid={`voices-chip-post-${toggle.id}`}>
              {toggle.label}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...filters,
                    surfaces: withoutPostType(filters.surfaces, toggle.surfaces),
                  })
                }
                className="ml-0.5 rounded-full hover:text-destructive"
                aria-label={`Remove ${toggle.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {visiblePeople.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 font-normal">
              {personNames[id] ?? "Celebrity"}
              <button
                type="button"
                onClick={() => removePerson(id)}
                className="ml-0.5 rounded-full hover:text-destructive"
                aria-label={`Remove ${personNames[id] ?? "celebrity"} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.categories.map((id) => {
            const label = categoryFilterLabel(id, registryLabels);
            return (
              <Badge key={id} variant="outline" className="gap-1 font-normal">
                {label}
                <button
                  type="button"
                  onClick={() => toggleCategory(id)}
                  className="ml-0.5 rounded-full hover:text-destructive"
                  aria-label={`Remove ${label} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {panel}
    </div>
  );
}
