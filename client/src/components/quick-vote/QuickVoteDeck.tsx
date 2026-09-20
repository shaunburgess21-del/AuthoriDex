/**
 * Quick Vote deck — transform-driven vertical card pager.
 *
 * The browser never scrolls anything here. Pages sit at absolute offsets
 * (index * stageHeight) inside a track that is moved with `translateY`; a
 * finger drags the track through Pointer Events (`touch-action: none` on the
 * stage) and release hands off to a framer-motion spring that lands on the
 * next/previous page. There is therefore no scroll position for iOS WebKit
 * to snap, re-snap, pause or strand — the whole class of native
 * scroll-snap interactions that repeatedly jammed the deck on rating cards
 * (and that desktop Chromium could never reproduce) does not exist.
 *
 * Exposes the same `SnapViewApi` surface and page chrome (glass shell,
 * header slot, X close, centred card, hovering action-bar footer) as the
 * minimal variant of VoteSnapScrollView, so QuickVoteOverlay swaps engines
 * without touching cards or footers. `?qvdeck=snap` restores the legacy
 * native column for A/B on device.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  type AnimationPlaybackControls,
} from "framer-motion";
import { X } from "lucide-react";
import type {
  SnapItem,
  SnapRenderContext,
  SnapViewApi,
} from "@/components/snap-scroll/VoteSnapScrollView";
import { qvBump, qvDebugEnabled, qvLog, qvSetState } from "@/lib/quickVoteDebug";

/** Pages kept mounted either side of the current one (images warm, footer
 * ready) — matches the legacy column's ±2 window. */
const MOUNT_RADIUS = 2;
/** Finger travel before a touch stops being a tap and becomes a drag. Below
 * this, nothing is captured and the native click reaches the card control. */
const TAP_SLOP_PX = 8;
/** Fraction of the stage height a slow drag must cover to commit a page. */
const COMMIT_DISTANCE_RATIO = 0.22;
/** Release velocity (px/ms) that commits a page regardless of distance. */
const COMMIT_VELOCITY_PX_MS = 0.45;
/** How far ahead (ms) release velocity is projected for the distance test. */
const PROJECT_MS = 120;
/** Window of pointer samples used for the release velocity. */
const VELOCITY_WINDOW_MS = 90;
/** Overscroll resistance past the first / last page. */
const RUBBER_BAND = 0.35;
const MAX_OVERSCROLL_RATIO = 0.25;
/** Synthetic click that can follow pointerup after a drag is swallowed. */
const CLICK_SUPPRESS_MS = 350;
/** Desktop / emulator convenience: wheel notches page the deck. */
const WHEEL_STEP_PX = 30;
const WHEEL_COOLDOWN_MS = 400;

/** Same page insets as the minimal snap variant so cards sit identically. */
const PAGE_INSET = "max(0.75rem, env(safe-area-inset-bottom, 0px))";
const FOOTER_SPACE = "72px";
const FOOTER_BOTTOM = `calc(${PAGE_INSET} + 8px)`;

export interface QuickVoteDeckProps {
  open: boolean;
  onClose: () => void;
  items: SnapItem[];
  /** Card to start on (post-signup restore). Applied once it hydrates. */
  initialItemId?: string;
  renderCard: (item: SnapItem, ctx: SnapRenderContext) => ReactNode;
  /** Rendered pinned near the bottom of each page (action bar). */
  renderPageFooter?: (item: SnapItem, ctx: SnapRenderContext) => ReactNode;
  /** Rendered in the header, left of the X close (search). */
  headerSlot?: ReactNode;
  /** Imperative controls (auto-advance, search jump, gesture release). */
  apiRef?: MutableRefObject<SnapViewApi | null>;
  onVisibleIndexChange?: (index: number, item: SnapItem | null) => void;
  /**
   * Follow the current card by id when `items` change even before the
   * visitor has navigated. Off while hydration lists are still landing
   * (card 1 must stay card 1 as lists arrive in any order); the overlay
   * turns it on once every source has settled, so later reorders — a
   * filter toggle, a refetch inserting ahead — keep the card on screen.
   */
  followCurrent?: boolean;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  /** Track offset when the finger landed (mid-spring grabs continue from
   * wherever the track was, not from the committed page). */
  baseY: number;
  locked: "v" | "h" | null;
  captured: boolean;
  samples: Array<{ t: number; y: number }>;
}

function rubberBand(raw: number, stageH: number, count: number): number {
  const min = -Math.max(0, count - 1) * stageH;
  const max = 0;
  const cap = stageH * MAX_OVERSCROLL_RATIO;
  if (raw > max) return max + Math.min((raw - max) * RUBBER_BAND, cap);
  if (raw < min) return min - Math.min((min - raw) * RUBBER_BAND, cap);
  return raw;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  );
}

export function QuickVoteDeck({ open, ...rest }: QuickVoteDeckProps) {
  return (
    <AnimatePresence>
      {open && <DeckInner key="quick-vote-deck" {...rest} />}
    </AnimatePresence>
  );
}

function DeckInner({
  onClose,
  items,
  initialItemId,
  renderCard,
  renderPageFooter,
  headerSlot,
  apiRef,
  onVisibleIndexChange,
  followCurrent = false,
}: Omit<QuickVoteDeckProps, "open">) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageH, setStageH] = useState(0);
  const stageHRef = useRef(0);

  const [current, setCurrent] = useState(() => {
    if (!initialItemId) return 0;
    const idx = items.findIndex((i) => i.id === initialItemId);
    return idx >= 0 ? idx : 0;
  });
  const currentRef = useRef(current);
  currentRef.current = current;
  const currentIdRef = useRef<string | null>(items[current]?.id ?? null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Initial card applied (or the visitor moved first, which wins). */
  const initialAppliedRef = useRef(
    !initialItemId || items.some((i) => i.id === initialItemId),
  );
  /** The visitor (or auto-advance) has navigated. Before that, hydration
   * lists arriving in any order must not carry the deck away from card 1:
   * the first hydrated list may be ratings, so following "the card they are
   * looking at" would open on card 4 once matchups land in front of it. */
  const engagedRef = useRef(Boolean(initialItemId) && initialAppliedRef.current);

  const y = useMotionValue(0);
  const animRef = useRef<AnimationPlaybackControls | null>(null);
  /** Velocity the in-flight spring was launched with — y.getVelocity() is
   * still 0 if it is re-targeted before its first frame. */
  const animVelocityRef = useRef(0);
  const dragRef = useRef<DragSession | null>(null);
  const suppressClickUntilRef = useRef(0);
  const wheelAccumRef = useRef(0);
  const wheelCooldownUntilRef = useRef(0);

  if (qvDebugEnabled()) qvBump("renders");

  const stopAnimation = useCallback(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
      qvSetState({ tweenActive: false });
    }
  }, []);

  /** Commit `index` as the current page and move the track there. */
  const goTo = useCallback(
    (
      index: number,
      opts: { animated: boolean; velocity?: number; reason: string; engage?: boolean },
    ) => {
      const count = itemsRef.current.length;
      if (count === 0) return;
      const target = Math.max(0, Math.min(count - 1, index));
      const h = stageHRef.current;
      const from = currentRef.current;
      currentRef.current = target;
      currentIdRef.current = itemsRef.current[target]?.id ?? null;
      initialAppliedRef.current = true;
      if (opts.engage !== false) engagedRef.current = true;
      setCurrent(target);
      stopAnimation();
      const destY = -target * h;
      if (!opts.animated || h === 0) {
        y.set(destY);
        qvLog("deck.jump", { from, to: target, reason: opts.reason });
        return;
      }
      qvLog("deck.go", {
        from,
        to: target,
        reason: opts.reason,
        v: Math.round(opts.velocity ?? 0),
      });
      qvSetState({ tweenActive: true });
      animVelocityRef.current = opts.velocity ?? 0;
      animRef.current = animate(y, destY, {
        type: "spring",
        stiffness: 420,
        damping: 42,
        mass: 1,
        velocity: opts.velocity ?? 0,
        restDelta: 0.5,
        restSpeed: 5,
        onComplete: () => {
          animRef.current = null;
          qvSetState({ tweenActive: false });
          qvLog("deck.settle", { idx: target });
        },
      });
    },
    [stopAnimation, y],
  );

  /**
   * The current card moved to a new index because items were inserted or
   * removed in front of it (e.g. a voted card dropping out of a filtered
   * deck). Shift the track by the same amount the pages moved so the
   * visitor sees nothing — including mid-spring and mid-drag, where a plain
   * jump would cut the landing animation short.
   */
  const relocate = useCallback(
    (target: number, reason: string) => {
      const h = stageHRef.current;
      const from = currentRef.current;
      const shift = (from - target) * h;
      currentRef.current = target;
      currentIdRef.current = itemsRef.current[target]?.id ?? null;
      setCurrent(target);
      qvLog("deck.relocate", {
        from,
        to: target,
        reason,
        y: Math.round(y.get()),
        v: Math.round(y.getVelocity()),
        anim: animRef.current != null,
      });
      if (shift === 0) return;
      const drag = dragRef.current;
      if (drag) {
        drag.baseY += shift;
        y.set(y.get() + shift);
        return;
      }
      if (animRef.current) {
        const velocity = y.getVelocity() || animVelocityRef.current;
        stopAnimation();
        y.set(y.get() + shift);
        qvSetState({ tweenActive: true });
        animVelocityRef.current = velocity;
        animRef.current = animate(y, -target * h, {
          type: "spring",
          stiffness: 420,
          damping: 42,
          mass: 1,
          velocity,
          restDelta: 0.5,
          restSpeed: 5,
          onComplete: () => {
            animRef.current = null;
            qvSetState({ tweenActive: false });
            qvLog("deck.settle", { idx: target });
          },
        });
        return;
      }
      y.set(-target * h);
    },
    [stopAnimation, y],
  );

  // ── Stage measurement ─────────────────────────────────────────────────
  // Pages are sized in px from the stage's live height (not dvh), so the
  // iOS toolbar collapsing simply re-lays the pages and re-anchors the
  // track — nothing can drift out of alignment.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.clientHeight;
      if (h === 0 || h === stageHRef.current) return;
      const prev = stageHRef.current;
      stageHRef.current = h;
      setStageH(h);
      if (prev !== 0) qvBump("resizeChanges");
      qvLog("deck.resize", { from: prev, to: h });
      if (!dragRef.current) {
        stopAnimation();
        y.set(-currentRef.current * h);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stopAnimation, y]);

  // ── Items identity changes (hydration, refetch) ───────────────────────
  useEffect(() => {
    const count = items.length;
    if (count === 0) return;
    if (!initialAppliedRef.current && initialItemId) {
      const idx = items.findIndex((i) => i.id === initialItemId);
      if (idx >= 0) {
        // A restored card is a commitment: follow it by id from here on.
        goTo(idx, { animated: false, reason: "initial" });
        return;
      }
    }
    const cur = currentRef.current;
    const id = currentIdRef.current;
    if (items[cur]?.id === id) return;
    // Not yet engaged (and hydration still landing): keep the index — card 1
    // stays card 1 while lists arrive. Otherwise follow the card the
    // visitor is looking at.
    const follow = engagedRef.current || followCurrent;
    const relocated = follow && id ? items.findIndex((i) => i.id === id) : -1;
    if (relocated >= 0) {
      relocate(relocated, "items-reorder");
    } else if (cur > count - 1) {
      goTo(count - 1, { animated: false, reason: "items-shrink", engage: false });
    } else {
      currentIdRef.current = items[cur]?.id ?? null;
    }
  }, [items, initialItemId, followCurrent, goTo, relocate]);

  // ── Visible-index notification ────────────────────────────────────────
  useEffect(() => {
    qvSetState({ committedIdx: current, pendingIdx: null });
    onVisibleIndexChange?.(current, items[current] ?? null);
  }, [current, items, onVisibleIndexChange]);

  // ── Imperative API ────────────────────────────────────────────────────
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      advanceToNext: () => {
        if (dragRef.current) return;
        const cur = currentRef.current;
        if (cur + 1 >= itemsRef.current.length) return;
        qvLog("api.advance", { from: cur });
        goTo(cur + 1, { animated: true, reason: "auto-advance" });
      },
      scrollToIndex: (index: number) => {
        if (index < 0 || index >= itemsRef.current.length) return;
        qvLog("api.jump", { index });
        dragRef.current = null;
        goTo(index, { animated: false, reason: "search" });
      },
      releaseGestures: () => {
        qvLog("deck.release", { drag: !!dragRef.current });
        dragRef.current = null;
        stopAnimation();
        y.set(-currentRef.current * stageHRef.current);
        qvSetState({ touchActive: false });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, goTo, stopAnimation, y]);

  useEffect(() => () => stopAnimation(), [stopAnimation]);

  // ── Debug gauges ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!qvDebugEnabled()) return;
    qvSetState({ engine: "deck" });
    return y.on("change", (v) => {
      qvSetState({ deckY: Math.round(v) });
    });
  }, [y]);

  // ── Pointer gesture ───────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const stage = stageRef.current;
      // Portalled overlays (comments sheet, share) bubble through React but
      // live outside the stage DOM — never treat their touches as drags.
      if (!stage || !(e.target instanceof Node) || !stage.contains(e.target)) return;
      if (dragRef.current) return;
      // Finger down mid-spring (auto-advance, previous fling): freeze the
      // track where it is and continue from there.
      stopAnimation();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseY: y.get(),
        locked: null,
        captured: false,
        samples: [{ t: e.timeStamp, y: e.clientY }],
      };
      qvLog("touch.start", { y: Math.round(y.get()), type: e.pointerType });
    },
    [stopAnimation, y],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.locked === null) {
        if (Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX) return;
        d.locked = Math.abs(dy) >= Math.abs(dx) ? "v" : "h";
        if (d.locked === "v") {
          try {
            stageRef.current?.setPointerCapture(d.pointerId);
            d.captured = true;
          } catch {
            /* capture unsupported — moves still bubble to the stage */
          }
          qvSetState({ touchActive: true });
          qvLog("drag.lock", { dy: Math.round(dy) });
        }
      }
      if (d.locked !== "v") return;
      const now = e.timeStamp;
      d.samples.push({ t: now, y: e.clientY });
      while (d.samples.length > 2 && now - d.samples[0].t > VELOCITY_WINDOW_MS) {
        d.samples.shift();
      }
      y.set(rubberBand(d.baseY + dy, stageHRef.current, itemsRef.current.length));
    },
    [y],
  );

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      if (d.captured) {
        try {
          stageRef.current?.releasePointerCapture(d.pointerId);
        } catch {
          /* already released */
        }
      }
      // Tap (or a horizontal wiggle): nothing moved, let the native click
      // reach whatever control is under the finger.
      if (d.locked !== "v") return;
      qvSetState({ touchActive: false });
      suppressClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS;

      const h = stageHRef.current;
      const cur = currentRef.current;
      if (h === 0) return;
      if (cancelled) {
        qvLog("touch.cancel", { idx: cur });
        goTo(cur, { animated: true, reason: "cancel" });
        return;
      }

      // Velocity (px/ms) over the last VELOCITY_WINDOW_MS. Negative = finger
      // moving up = track moving up = towards the next card.
      const first = d.samples[0];
      const last = d.samples[d.samples.length - 1];
      const dt = Math.max(last.t - first.t, 1);
      const v = d.samples.length > 1 ? (last.y - first.y) / dt : 0;

      // Finger travel, not track displacement from the committed page: a
      // second flick that lands mid-spring must still count as one more
      // page, even though the track has not yet reached the page it was
      // already heading for.
      const towardNext = -(e.clientY - d.startY);
      const projected = towardNext + -v * PROJECT_MS;
      let dir = 0;
      if (Math.abs(v) >= COMMIT_VELOCITY_PX_MS) dir = v < 0 ? 1 : -1;
      else if (Math.abs(projected) >= h * COMMIT_DISTANCE_RATIO) dir = projected > 0 ? 1 : -1;
      // A decisive flick back across the origin returns to the current card
      // rather than skipping over it to the far side.
      if (dir === 1 && towardNext < -TAP_SLOP_PX) dir = 0;
      if (dir === -1 && towardNext > TAP_SLOP_PX) dir = 0;

      qvLog("touch.end", {
        idx: cur,
        dy: Math.round(towardNext),
        v: Math.round(v * 100) / 100,
        dir,
      });
      goTo(cur + dir, { animated: true, velocity: v * 1000, reason: "swipe" });
    },
    [goTo, y],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finishDrag(e, false),
    [finishDrag],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finishDrag(e, true),
    [finishDrag],
  );

  // A drag must never end as a tap on whatever control the finger lifted
  // over. Capture-phase on the stage runs before React's root listener.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const swallow = (e: Event) => {
      if (performance.now() < suppressClickUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("click", swallow, true);
    return () => el.removeEventListener("click", swallow, true);
  }, []);

  // Wheel / trackpad paging (desktop + emulator; no-op on phones).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      if (now < wheelCooldownUntilRef.current) return;
      wheelAccumRef.current += e.deltaY;
      if (Math.abs(wheelAccumRef.current) < WHEEL_STEP_PX) return;
      const dir = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      wheelCooldownUntilRef.current = now + WHEEL_COOLDOWN_MS;
      goTo(currentRef.current + dir, { animated: true, reason: "wheel" });
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goTo]);

  // Keyboard: arrows page, Escape closes (unless a sheet owns the key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextEntryTarget(e.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goTo(currentRef.current + 1, { animated: true, reason: "key" });
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goTo(currentRef.current - 1, { animated: true, reason: "key" });
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, onClose]);

  // ── Render ────────────────────────────────────────────────────────────
  const hasFooter = !!renderPageFooter;
  const mountStart = Math.max(0, current - MOUNT_RADIUS);
  const mountEnd = Math.min(items.length - 1, current + MOUNT_RADIUS);
  const pages: ReactNode[] = [];
  if (stageH > 0) {
    for (let idx = mountStart; idx <= mountEnd; idx += 1) {
      const item = items[idx];
      if (!item) continue;
      const ctx: SnapRenderContext = { priority: true, index: idx };
      pages.push(
        <div
          key={item.id}
          className="absolute inset-x-0 flex flex-col items-center justify-center px-3"
          style={{
            top: idx * stageH,
            height: stageH,
            boxSizing: "border-box",
            paddingTop: PAGE_INSET,
            paddingBottom: hasFooter
              ? `calc(${PAGE_INSET} + ${FOOTER_SPACE})`
              : PAGE_INSET,
          }}
          data-qv-page={idx}
        >
          <div className="w-full max-w-lg mx-auto max-h-full overflow-clip rounded-[12px] shadow-2xl shadow-black/60 ring-1 ring-white/10">
            {renderCard(item, ctx)}
          </div>
          {hasFooter ? (
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center"
              style={{ bottom: FOOTER_BOTTOM }}
            >
              <div className="pointer-events-auto">{renderPageFooter!(item, ctx)}</div>
            </div>
          ) : null}
        </div>,
      );
    }
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] flex flex-col bg-black/40 backdrop-blur-md"
      data-testid="quick-vote-deck"
    >
      {/* Header: absolute so the stage is full-bleed under it and cards
          centre in the visible glass (same as the minimal snap chrome). */}
      <div
        className="absolute inset-x-0 top-0 z-20 flex items-center px-1"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          height: "calc(52px + env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="flex-1 min-w-0 pl-3">{headerSlot}</div>
        <button
          onClick={onClose}
          className="p-3 text-white/80 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-interactive="true"
          aria-label="Close quick vote"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Stage: owns the gesture. touch-action none = the browser never
          scrolls, zooms or pans here; every finger movement is ours. */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{
          touchAction: "none",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
        }}
        data-qv-column=""
        data-qv-deck=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <motion.div
          className="absolute inset-x-0 top-0 will-change-transform"
          style={{ y }}
          data-qv-track=""
        >
          {pages}
        </motion.div>
      </div>
    </motion.div>
  );
}
