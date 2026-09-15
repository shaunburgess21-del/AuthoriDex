/**
 * Persistent Quick Vote header search — glass pill + results sheet that
 * jumps the snap deck to a card. Lives in the overlay chrome (not the
 * scroller) so it cannot steal vertical swipe.
 */
import { useRef } from "react";
import { Search, X } from "lucide-react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import {
  QUICK_VOTE_SEARCH_MIN_CHARS,
  type QuickVoteSearchHit,
} from "@/lib/quickVoteSearch";

const SCALE_EPS = 0.02;
const OFFSET_EPS = 2;

/** Drop leftover iOS Safari input-zoom without locking pinch-zoom site-wide.
 * Briefly adds maximum-scale=1 to the viewport meta, then restores it. */
export function resetIosInputZoom(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const vv = window.visualViewport;
  const scaleOff = vv != null && Math.abs(vv.scale - 1) > SCALE_EPS;
  const offsetOff =
    vv != null &&
    (Math.abs(vv.offsetLeft) > OFFSET_EPS || Math.abs(vv.offsetTop) > OFFSET_EPS);
  if (!scaleOff && !offsetOff) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute("content") || "";
  if (!original.includes("maximum-scale")) {
    meta.setAttribute("content", `${original}, maximum-scale=1.0`);
  }
  requestAnimationFrame(() => {
    meta.setAttribute("content", original);
  });
}

const TYPE_LABEL: Record<QuickVoteSearchHit["type"], string> = {
  matchup: "Matchup",
  sentiment: "Sentiment",
  opinion: "Opinion",
  rating: "Rating",
};

export interface QuickVoteSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
  results: QuickVoteSearchHit[];
  onSelect: (hit: QuickVoteSearchHit) => void;
}

export function QuickVoteSearch({
  query,
  onQueryChange,
  results,
  onSelect,
}: QuickVoteSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showSheet = query.trim().length >= QUICK_VOTE_SEARCH_MIN_CHARS;

  const dismissSheet = () => {
    onQueryChange("");
    inputRef.current?.blur();
  };

  const selectHit = (hit: QuickVoteSearchHit) => {
    inputRef.current?.blur();
    onSelect(hit);
  };

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
        <input
          ref={inputRef}
          type="text"
          enterKeyHint="search"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              dismissSheet();
              return;
            }
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              selectHit(results[0]);
            }
          }}
          placeholder="Find a vote"
          aria-label="Find a vote"
          data-interactive="true"
          data-testid="quick-vote-search"
          onBlur={() => resetIosInputZoom()}
          className="h-9 w-full rounded-full border border-white/15 bg-black/30 py-0 pl-9 pr-9 text-[16px] text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            data-interactive="true"
            data-testid="quick-vote-search-clear"
            onClick={dismissSheet}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showSheet && (
        <>
          <button
            type="button"
            aria-label="Dismiss search"
            data-interactive="true"
            className="fixed inset-x-0 bottom-0 z-10 bg-black/40"
            style={{ top: "calc(52px + env(safe-area-inset-top, 0px))" }}
            onClick={dismissSheet}
          />
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-[min(50dvh,22rem)] overflow-y-auto rounded-2xl border border-white/15 bg-black/75 py-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl"
            data-testid="quick-vote-search-results"
          >
            {results.length === 0 ? (
              <li className="px-4 py-3 text-center text-sm text-white/55">
                No votes match. Try another name.
              </li>
            ) : (
              results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    role="option"
                    data-interactive="true"
                    data-testid={`quick-vote-search-hit-${hit.id}`}
                    onClick={() => selectHit(hit)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/10 active:bg-white/15"
                  >
                    <SearchThumbs thumbA={hit.thumbA} thumbB={hit.thumbB} />
                    <span className="min-w-0 flex-1">
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        {TYPE_LABEL[hit.type]}
                      </span>
                      <span className="block truncate text-sm font-medium text-slate-100">
                        {hit.label}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function SearchThumbs({
  thumbA,
  thumbB,
}: {
  thumbA?: string | null;
  thumbB?: string | null;
}) {
  if (!thumbA && !thumbB) {
    return (
      <span
        aria-hidden
        className="h-9 w-9 shrink-0 rounded-lg bg-white/10 ring-1 ring-white/10"
      />
    );
  }
  if (thumbA && thumbB) {
    return (
      <span className="relative h-9 w-11 shrink-0">
        <img
          src={getDisplayImageUrl(thumbA, { width: 80 })}
          alt=""
          className="absolute left-0 top-0 h-9 w-9 rounded-lg object-cover ring-1 ring-black/40"
        />
        <img
          src={getDisplayImageUrl(thumbB, { width: 80 })}
          alt=""
          className="absolute right-0 top-0 h-9 w-9 rounded-lg object-cover ring-1 ring-black/40"
        />
      </span>
    );
  }
  const src = thumbA || thumbB;
  return (
    <img
      src={getDisplayImageUrl(src!, { width: 80 })}
      alt=""
      className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
    />
  );
}
