/**
 * Step 1 — Year Born.
 *
 * Vertical scroll wheel inspired by the iOS UIPickerView. The list is
 * a regular scroll container so we get native momentum + accessibility
 * (VoiceOver, screen-readers, keyboard PageUp/PageDown) for free, and
 * we add visual depth by:
 *
 *   - A fixed selection band (centred, primary outline).
 *   - Dynamic per-row scale + opacity based on distance from centre,
 *     producing a subtle 3D wheel effect.
 *   - Top + bottom gradient masks that fade rows toward the edges.
 *
 * Snap-to-row is handled via CSS `scroll-snap-align: center`. We read
 * the selected year from the row whose centre is closest to the
 * container centre, debounced to the next animation frame so we don't
 * thrash on every scroll tick.
 *
 * Mouse-wheel and touch are both first-class — both are native
 * scrolling. Keyboard arrow-up / arrow-down step year-by-year and
 * smooth-scroll the focused row into view.
 *
 * Range is 1924..2010 inclusive (matches the spec). Default focus is
 * 1990 unless the user has already saved a `dateOfBirth`, in which
 * case we resume from that year.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const MIN_YEAR = 1924;
const MAX_YEAR = 2010;
const DEFAULT_YEAR = 1990;
const ROW_HEIGHT = 56;
/** Number of rows visible above/below the selection band. */
const PAD_ROWS = 3;
const VIEWPORT_HEIGHT = ROW_HEIGHT * (PAD_ROWS * 2 + 1);

interface YearWheelProps {
  /** Pre-selected year as `YYYY-MM-DD`, or null. */
  initialDateOfBirth: string | null;
  onChange: (year: number) => void;
}

export function YearWheel({ initialDateOfBirth, onChange }: YearWheelProps) {
  const initialYear = useMemo(() => {
    if (initialDateOfBirth && /^\d{4}-/.test(initialDateOfBirth)) {
      const y = Number(initialDateOfBirth.slice(0, 4));
      if (y >= MIN_YEAR && y <= MAX_YEAR) return y;
    }
    return DEFAULT_YEAR;
  }, [initialDateOfBirth]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = MAX_YEAR; y >= MIN_YEAR; y--) list.push(y);
    return list;
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<number>(initialYear);
  // Per-row distance state for the depth effect. Updated on scroll
  // via rAF so we only repaint at most once per frame.
  const [scrollTop, setScrollTop] = useState<number>(0);
  const rafRef = useRef<number | null>(null);

  // Centre the initial year on mount. The padding rows above the
  // first real row mean year[0] sits at scrollTop=0; selecting
  // initialYear means scrolling to that row's index * ROW_HEIGHT.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = years.indexOf(initialYear);
    if (idx < 0) return;
    el.scrollTop = idx * ROW_HEIGHT;
    setScrollTop(idx * ROW_HEIGHT);
  }, [initialYear, years]);

  // Notify parent on initial mount + every selection change.
  useEffect(() => {
    onChange(selected);
  }, [selected, onChange]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const top = el.scrollTop;
      setScrollTop(top);
      const idx = Math.round(top / ROW_HEIGHT);
      const clamped = Math.max(0, Math.min(years.length - 1, idx));
      setSelected(years[clamped]);
    });
  }, [years]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Mouse-wheel support: native browsers fire a single wheel detent at
  // ~100px deltaY which lands BETWEEN two rows at our 56px row height,
  // so the rounded scroll handler intermittently snapped to the row
  // 2 away from where the user expected. Take the wheel over and
  // step exactly one year per detent. Trackpads send small fractional
  // deltas, so we accumulate until |accum| >= 1 before stepping.
  //
  // Bound as a non-passive native listener (React's synthetic onWheel
  // is passive in modern browsers, which silently no-ops
  // preventDefault). We intentionally only handle vertical wheel —
  // shift+wheel / horizontal trackpad gestures are ignored.
  const wheelAccumRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Horizontal-only gestures (trackpad swipe, shift+wheel) shouldn't
      // hijack the year wheel — let them pass through harmlessly.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();

      // Normalise the delta so a typical mouse detent (~100px) and a
      // small trackpad nudge each contribute proportionally to one
      // "tick". 100 was tuned to feel like one year per click, with
      // a small trackpad scroll still requiring a real gesture.
      wheelAccumRef.current += e.deltaY / 100;
      const steps = Math.trunc(wheelAccumRef.current);
      if (steps === 0) return;
      wheelAccumRef.current -= steps;

      const currentIdx = Math.round(el.scrollTop / ROW_HEIGHT);
      const nextIdx = Math.max(
        0,
        Math.min(years.length - 1, currentIdx + steps),
      );
      el.scrollTo({ top: nextIdx * ROW_HEIGHT, behavior: "smooth" });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [years.length]);

  // Keyboard support: ArrowUp / ArrowDown step one year. The browser
  // would otherwise scroll by ~40px which doesn't align to a row, so
  // we override and call scrollTo with smooth behaviour.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = years.indexOf(selected);
      let nextIdx = idx;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        nextIdx = Math.min(years.length - 1, idx + (e.key === "PageDown" ? 5 : 1));
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        nextIdx = Math.max(0, idx - (e.key === "PageUp" ? 5 : 1));
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = years.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      el.scrollTo({ top: nextIdx * ROW_HEIGHT, behavior: "smooth" });
    },
    [selected, years],
  );

  return (
    <div className="relative mx-auto w-full max-w-[14rem] select-none">
      {/* Selection band — sits behind the rows.
          Lifted 25px above geometric centre so the digit glyphs sit
          visually centred inside it. Tuned by eye against the
          rendered viewport rather than purely against the line-box
          metrics — at text-3xl with our serif stack 25px landed dead
          on; smaller values still read as the band hanging below
          the year. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10"
        style={{
          height: ROW_HEIGHT,
          transform: "translateY(calc(-50% - 25px))",
        }}
      >
        <div className="mx-2 h-full rounded-2xl border border-primary/40 bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15),0_0_24px_-6px_hsl(var(--primary)/0.5)]" />
      </div>

      {/* Edge fades — top + bottom masks make rows recede into the
          background. The gradient stops match the row positions so
          the transition feels mechanical rather than mushy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            "linear-gradient(to bottom, hsl(var(--background)) 0%, hsl(var(--background) / 0.0) 28%, hsl(var(--background) / 0.0) 72%, hsl(var(--background)) 100%)",
        }}
      />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label="Year of birth"
        aria-activedescendant={`year-${selected}`}
          className="scrollbar-hide relative overflow-y-auto rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        style={{
          height: VIEWPORT_HEIGHT,
          scrollSnapType: "y mandatory",
          // The scroll-padding lines up snap targets with the band.
          scrollPaddingBlock: PAD_ROWS * ROW_HEIGHT,
        }}
        data-testid="year-wheel"
      >
        {/* Spacers above and below give the first / last year room to
            scroll into the centre band. */}
        <div style={{ height: PAD_ROWS * ROW_HEIGHT }} aria-hidden="true" />
        {years.map((year, idx) => {
          // The PAD_ROWS spacer above the first year row shifts every
          // year[idx] down by PAD_ROWS * ROW_HEIGHT in the DOM. Account
          // for that here — without it the depth math thinks the
          // viewport centre is PAD_ROWS rows higher than it actually
          // is, so the row in the selection band scores the LARGEST
          // distance and renders smallest while rows below the band
          // render biggest. Adding PAD_ROWS to the index makes the
          // selected row score distance=0 (full scale, full opacity).
          const rowCentre = (idx + PAD_ROWS) * ROW_HEIGHT + ROW_HEIGHT / 2;
          const viewportCentre = scrollTop + VIEWPORT_HEIGHT / 2;
          const distance = Math.abs(rowCentre - viewportCentre);
          // Translate distance → scale + opacity. Rows within ~half a row
          // of centre are full-size + full-opacity; further rows shrink
          // to ~70% and fade to ~25%.
          const norm = Math.min(1, distance / (ROW_HEIGHT * PAD_ROWS));
          const scale = 1 - norm * 0.3;
          const opacity = 1 - norm * 0.75;
          const isSelected = year === selected;
          return (
            <div
              key={year}
              id={`year-${year}`}
              role="option"
              aria-selected={isSelected}
              className="flex items-center justify-center"
              style={{
                height: ROW_HEIGHT,
                scrollSnapAlign: "center",
                transform: `scale(${scale.toFixed(3)})`,
                opacity: opacity.toFixed(3),
                transformOrigin: "center",
                transition: "color 150ms ease",
              }}
            >
              <span
                className={cn(
                  "font-serif text-3xl tabular-nums tracking-tight",
                  isSelected
                    ? "font-bold text-foreground"
                    : "font-medium text-muted-foreground",
                )}
              >
                {year}
              </span>
            </div>
          );
        })}
        <div style={{ height: PAD_ROWS * ROW_HEIGHT }} aria-hidden="true" />
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Scroll, swipe, or use ↑ / ↓ to choose.
      </p>
    </div>
  );
}

export function buildDateOfBirth(year: number): string {
  return `${String(year).padStart(4, "0")}-01-01`;
}
