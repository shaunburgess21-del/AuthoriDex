import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CardGridSkeleton } from "@/components/ui/card-skeletons";
import {
  VOTE_FEED_PAGE_SIZE,
  VOTE_FEED_ROW_GAP,
  VOTE_FEED_ROW_HEIGHT,
  feedItemFillsRow,
  feedSpacerRows,
  layoutFeedRows,
  snapFeedWindow,
  voteFeedSpan,
  writeVoteMixedFeedPlace,
  type VoteFeedKind,
  type VoteFeedSpan,
} from "@/lib/voteMixedFeed";

const MOBILE_ESTIMATE_PX = 640;
const DESKTOP_BREAKPOINT = "(min-width: 768px)";

export interface VoteMixedFeedItem {
  key: string;
  kind: VoteFeedKind;
  id: string;
}

interface VoteMixedFeedProps<T extends VoteMixedFeedItem> {
  items: readonly T[];
  loading: boolean;
  /** Changes when category, search, or my-votes changes. Resets the window. */
  filterKey: string;
  restoreCardKey?: string | null;
  onAnchorChange?: (key: string) => void;
  empty: ReactNode;
  toolbar?: ReactNode;
  renderItem: (item: T, opts: { imagePriority: boolean }) => ReactNode;
}

function rootFontSize(): number {
  if (typeof document === "undefined") return 16;
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

function useFeedColumns(): 1 | 2 {
  const [columns, setColumns] = useState<1 | 2>(() =>
    typeof window !== "undefined" && window.matchMedia(DESKTOP_BREAKPOINT).matches ? 2 : 1,
  );
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_BREAKPOINT);
    const apply = () => setColumns(media.matches ? 2 : 1);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return columns;
}

function stickyBottom(): number {
  const band = document.querySelector("[data-testid='vote-sticky-band']");
  const bottom = band?.getBoundingClientRect().bottom ?? 0;
  return bottom > 0 ? bottom : 128;
}

/**
 * One document-scrolled list for the All view.
 * About 12 cards stay mounted. The page itself scrolls (no nested scroller),
 * which is what iOS Safari and WKWebView need for momentum scroll and lazy images.
 */
export function VoteMixedFeed<T extends VoteMixedFeedItem>({
  items,
  loading,
  filterKey,
  restoreCardKey,
  onAnchorChange,
  empty,
  toolbar,
  renderItem,
}: VoteMixedFeedProps<T>) {
  const columns = useFeedColumns();
  const listRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef(new Map<string, number>());
  const anchorRef = useRef<string | null>(null);
  const [measureTick, setMeasureTick] = useState(0);
  const [range, setRange] = useState(() => ({ start: 0, end: VOTE_FEED_PAGE_SIZE }));
  const filterInit = useRef(filterKey);
  const didPlaceRestore = useRef(false);
  const didScrollRestore = useRef(false);
  const scrollLock = useRef(Boolean(restoreCardKey));

  const spans = useMemo<VoteFeedSpan[]>(
    () => items.map((item) => voteFeedSpan(item.kind)),
    [items],
  );

  const applyWindow = useCallback(
    (anchorIndex: number) => {
      const next = snapFeedWindow(spans, anchorIndex, columns, VOTE_FEED_PAGE_SIZE);
      setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    },
    [spans, columns],
  );

  useLayoutEffect(() => {
    if (didPlaceRestore.current) return;
    if (!restoreCardKey) {
      scrollLock.current = false;
      return;
    }
    const index = items.findIndex((item) => item.key === restoreCardKey);
    if (index < 0) {
      if (!loading) {
        didPlaceRestore.current = true;
        scrollLock.current = false;
      }
      return;
    }
    applyWindow(Math.max(0, index));
    didPlaceRestore.current = true;
  }, [applyWindow, items, loading, restoreCardKey]);

  useLayoutEffect(() => {
    if (!restoreCardKey || !didPlaceRestore.current || didScrollRestore.current) return;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(restoreCardKey) : restoreCardKey;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-feed-key="${escaped}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "start" });
    didScrollRestore.current = true;
    scrollLock.current = false;
  }, [range, items, restoreCardKey]);

  useEffect(() => {
    if (filterInit.current === filterKey) return;
    filterInit.current = filterKey;
    didPlaceRestore.current = true;
    didScrollRestore.current = true;
    scrollLock.current = false;
    setRange({ start: 0, end: Math.min(VOTE_FEED_PAGE_SIZE, items.length) });
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    if (top < stickyBottom()) {
      window.scrollTo({ top: Math.max(0, window.scrollY + top - stickyBottom()), behavior: "auto" });
    }
  }, [filterKey, items.length]);

  const indexAtScroll = useCallback((): number => {
    const list = listRef.current;
    if (!list || items.length === 0) return 0;
    const offset = window.scrollY + stickyBottom() - (list.getBoundingClientRect().top + window.scrollY);
    if (offset <= 8) return 0;
    if (columns === 2) {
      const stride = rootFontSize() * (32 + 1.25);
      const layout = layoutFeedRows(spans, 2);
      const row = Math.max(0, Math.floor(offset / stride));
      const index = layout.rowOfIndex.findIndex((value) => value >= row);
      return index < 0 ? items.length - 1 : index;
    }
    const gap = rootFontSize();
    let measured = 0;
    let measuredCount = 0;
    heightsRef.current.forEach((height) => {
      if (height > 0) {
        measured += height;
        measuredCount += 1;
      }
    });
    const estimate = measuredCount > 0 ? measured / measuredCount : MOBILE_ESTIMATE_PX;
    let y = 0;
    for (let i = 0; i < items.length; i += 1) {
      const height = heightsRef.current.get(items[i].key) ?? estimate;
      if (y + height >= offset) return i;
      y += height + gap;
    }
    return items.length - 1;
  }, [columns, items, spans]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (scrollLock.current || items.length === 0) return;
        const index = indexAtScroll();
        applyWindow(index);
        const key = items[index]?.key;
        if (key && key !== anchorRef.current) {
          anchorRef.current = key;
          writeVoteMixedFeedPlace(key);
          onAnchorChange?.(key);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [applyWindow, indexAtScroll, items, onAnchorChange]);

  useEffect(() => {
    const root = listRef.current;
    if (!root || columns !== 1) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.feedKey;
        if (!key) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const prev = heightsRef.current.get(key);
        if (height > 0 && (prev == null || Math.abs(prev - height) > 1)) {
          heightsRef.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setMeasureTick((tick) => tick + 1);
    });
    root.querySelectorAll<HTMLElement>("[data-feed-key]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [columns, range.start, range.end, items]);

  // WKWebView often skips loading="lazy" images that are already in view when
  // they mount. Promote those to eager; cards still below the fold stay lazy.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const images = root.querySelectorAll<HTMLImageElement>("img[loading='lazy']");
    if (images.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const image = entry.target as HTMLImageElement;
          image.loading = "eager";
          observer.unobserve(image);
        }
      },
      { root: null, rootMargin: "240px 0px" },
    );
    images.forEach((image) => observer.observe(image));
    return () => observer.disconnect();
  }, [range.start, range.end, items, measureTick]);

  const start = items.length === 0 ? 0 : Math.min(range.start, items.length - 1);
  const end = items.length === 0 ? 0 : Math.min(Math.max(range.end, start + 1), items.length);
  const visible = items.slice(start, end);
  const spacers = feedSpacerRows(spans, start, end, columns);

  let topSpacer: string | number = 0;
  let bottomSpacer: string | number = 0;
  if (columns === 2) {
    if (spacers.top > 0) {
      topSpacer = `calc(${spacers.top} * (${VOTE_FEED_ROW_HEIGHT} + ${VOTE_FEED_ROW_GAP}))`;
    }
    if (spacers.bottom > 0) {
      bottomSpacer = `calc(${spacers.bottom} * (${VOTE_FEED_ROW_HEIGHT} + ${VOTE_FEED_ROW_GAP}))`;
    }
  } else if (measureTick >= 0) {
    const gap = typeof window === "undefined" ? 16 : rootFontSize();
    let measured = 0;
    let measuredCount = 0;
    heightsRef.current.forEach((height) => {
      if (height > 0) {
        measured += height;
        measuredCount += 1;
      }
    });
    const estimate = measuredCount > 0 ? measured / measuredCount : MOBILE_ESTIMATE_PX;
    let above = 0;
    for (let i = 0; i < start; i += 1) {
      above += (heightsRef.current.get(items[i].key) ?? estimate) + gap;
    }
    let below = 0;
    for (let i = end; i < items.length; i += 1) {
      below += (heightsRef.current.get(items[i].key) ?? estimate) + gap;
    }
    topSpacer = above;
    bottomSpacer = below;
  }

  return (
    <section aria-label="All votes" data-testid="vote-mixed-feed" className="mb-10 mt-[5px]">
      {toolbar}
      {loading ? (
        <CardGridSkeleton count={3} />
      ) : items.length === 0 ? (
        empty
      ) : (
        <div ref={listRef} className="[overflow-anchor:none]">
          {topSpacer !== 0 && topSpacer !== "0" ? (
            <div aria-hidden style={{ height: topSpacer }} />
          ) : null}
          <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-stretch md:gap-5">
            {visible.map((item, localIndex) => (
              <div
                key={item.key}
                data-feed-key={item.key}
                data-feed-index={start + localIndex}
                data-testid={`vote-feed-card-${item.kind}-${item.id}`}
                className={`min-w-0 scroll-mt-32 ${feedItemFillsRow(spans, start + localIndex, columns) ? "md:col-span-2" : ""} md:h-[32rem]`}
              >
                {renderItem(item, { imagePriority: localIndex < 4 })}
              </div>
            ))}
          </div>
          {bottomSpacer !== 0 && bottomSpacer !== "0" ? (
            <div aria-hidden style={{ height: bottomSpacer }} />
          ) : null}
        </div>
      )}
    </section>
  );
}
