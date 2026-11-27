import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { browserLocalStorage } from "@/lib/returningUserStrip";
import { logFunnelEvent } from "@/lib/funnelTelemetry";
import { isNativeApp } from "@/lib/nativeOAuth";
import { isNativeSurface } from "@/lib/nativeCopy";
import { VOTE_STICKY_BAND_REVEAL } from "@/lib/voteMixedFeed";
import { cn } from "@/lib/utils";
import {
  CATEGORY_BAND_TEST_ID,
  PREDICT_NAV_TEST_IDS,
  RANKINGS_NAV_TEST_IDS,
  WELCOME_TOUR_CARD_ATTR,
  advanceTour,
  armTourRealVote,
  currentTourStep,
  lockDocumentScroll,
  pickVisibleId,
  placeBubble,
  readPracticeSplit,
  readSafeAreaInsets,
  roundSplitTo100,
  setWelcomeTourActive,
  startRunning,
  stepSpotlights,
  subscribeTourRequest,
  takeTourRequest,
  targetNeedsScroll,
  tourAnnouncement,
  tourNextLabel,
  tourStepCopy,
  tourTargetScrolls,
  writeTourSeen,
  type RectBox,
  type RunningTour,
  type TourPhase,
  type TourSource,
  type TourStepId,
} from "@/lib/welcomeTour";

const BUBBLE_HEIGHT_ESTIMATE = 240;
const SPLIT_BLOCK_PX = 96;

function bubbleWidthFor(viewportWidth: number): number {
  return viewportWidth >= 768 ? 320 : 304;
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function findPracticeCard(root: ParentNode): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>(`[${WELCOME_TOUR_CARD_ATTR}]`);
  for (const node of nodes) {
    if (node.closest('[aria-hidden="true"]')) continue;
    if (node.getClientRects().length === 0) continue;
    return node;
  }
  return null;
}

function findVisibleByTestId(root: ParentNode, testId: string): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`);
  for (const node of nodes) {
    if (node.getClientRects().length === 0) continue;
    return node;
  }
  return null;
}

function firstVisible(root: ParentNode, ids: readonly string[]): HTMLElement | null {
  const id = pickVisibleId(ids, (testId) => findVisibleByTestId(root, testId) != null);
  return id ? findVisibleByTestId(root, id) : null;
}

function sameBox(a: RectBox | null, b: RectBox | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function toBox(node: HTMLElement | null): RectBox | null {
  if (!node) return null;
  const box = node.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function measureNode(step: TourStepId): HTMLElement | null {
  if (step === "practice_tap" || step === "practice_reveal" || step === "your_turn") return findPracticeCard(document);
  if (step === "categories") return findVisibleByTestId(document, CATEGORY_BAND_TEST_ID);
  if (step === "predict") return firstVisible(document, PREDICT_NAV_TEST_IDS);
  if (step === "rankings") return firstVisible(document, RANKINGS_NAV_TEST_IDS);
  return null;
}

function measureStepTarget(step: TourStepId): RectBox | null {
  if (!stepSpotlights(step)) return null;
  return toBox(measureNode(step));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

function waitForScrollSettle(reduceMotion: boolean): Promise<void> {
  if (reduceMotion) return nextFrames(1);
  return new Promise((resolve) => {
    const started = performance.now();
    let timer = window.setTimeout(finish, 90);
    const onScroll = () => {
      if (performance.now() - started > 900) {
        finish();
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, 120);
    };
    function finish() {
      window.removeEventListener("scroll", onScroll);
      resolve();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  });
}

async function waitForSwipeCarouselGone(): Promise<void> {
  for (let frame = 0; frame < 24; frame += 1) {
    if (!document.querySelector("[data-testid='matchup-category-swipe']")) {
      await nextFrames(1);
      return;
    }
    await nextFrames(1);
  }
}

/**
 * Several identical frames, and a quiet ResizeObserver, before the hole is trusted.
 * A late image or the swipe carousel unmounting changes the card after the first read.
 */
async function waitForLayoutStable(read: () => RectBox | null, node: HTMLElement | null): Promise<RectBox | null> {
  let last = read();
  let stable = 0;
  let resized = false;
  const observer = node && typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => {
      resized = true;
    })
    : null;
  if (node && observer) observer.observe(node);
  for (let frame = 0; frame < 30 && stable < 4; frame += 1) {
    await nextFrames(1);
    if (resized) {
      resized = false;
      stable = 0;
    }
    const next = read();
    stable = sameBox(last, next) ? stable + 1 : 0;
    last = next;
  }
  observer?.disconnect();
  return last;
}

async function waitForCardImages(node: HTMLElement | null): Promise<void> {
  if (!node) return;
  const pending = [...node.querySelectorAll("img")].filter((img) => !img.complete);
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(pending.map((img) => new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    }))),
    delay(500),
  ]);
}

function revealScrollDelta(card: HTMLElement, bubbleHeight: number): number {
  const insets = readSafeAreaInsets(getComputedStyle(document.documentElement));
  const rect = card.getBoundingClientRect();
  const roomBelow = SPLIT_BLOCK_PX + 12 + bubbleHeight + 8;
  const maxBottom = window.innerHeight - insets.bottom - roomBelow;
  const delta = rect.bottom - maxBottom;
  if (delta > 2) return delta;
  const splitTop = rect.bottom + 10;
  const minTop = insets.top + 8;
  if (splitTop < minTop) return splitTop - minTop;
  return 0;
}

function scrollElementIntoView(element: HTMLElement, block: "center" | "start", reduceMotion: boolean): void {
  if (block === "start") {
    const header = document.querySelector("header");
    const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 64;
    const top = window.scrollY + element.getBoundingClientRect().top - headerHeight - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? "auto" : "smooth" });
    return;
  }
  element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
}

function readSideNames(): { a: string; b: string } | null {
  const card = findPracticeCard(document);
  const a = card?.getAttribute("data-option-a-text")?.trim() ?? "";
  const b = card?.getAttribute("data-option-b-text")?.trim() ?? "";
  if (!a && !b) return null;
  return { a, b };
}

function fitHole(
  rect: RectBox,
  reveal: boolean,
  insets: { top: number; right: number; bottom: number; left: number },
): { x: number; y: number; w: number; h: number } {
  const pad = 8;
  const margin = 8;
  let x = rect.left - pad;
  let y = rect.top - pad;
  let w = rect.width + pad * 2;
  let h = rect.height + pad * 2 + (reveal ? 76 : 0);
  const minX = insets.left + margin;
  const minY = insets.top + margin;
  const maxX = window.innerWidth - insets.right - margin;
  const maxY = window.innerHeight - insets.bottom - margin;
  if (x < minX) {
    w -= minX - x;
    x = minX;
  }
  if (y < minY) {
    h -= minY - y;
    y = minY;
  }
  if (x + w > maxX) w = Math.max(28, maxX - x);
  if (y + h > maxY) h = Math.max(28, maxY - y);
  return { x, y, w, h };
}

function barWidth(value: number): string {
  return `${Math.min(100, Math.max(0, value))}%`;
}

/**
 * Guided practice vote, then a short tour of chips, Predict, and Rankings.
 * Mounted on the vote hub. Requests can arrive before this mounts (the
 * account menu navigates here); session storage holds that request.
 */
export function WelcomeTourHost() {
  const reduce = usePrefersReducedMotion();
  const [phase, setPhase] = useState<TourPhase>({ status: "idle" });
  const [measured, setMeasured] = useState<{ step: TourStepId; rect: RectBox | null } | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(BUBBLE_HEIGHT_ESTIMATE);
  const [practiceLive, setPracticeLive] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleHeightRef = useRef(bubbleHeight);
  bubbleHeightRef.current = bubbleHeight;
  const endedRef = useRef(false);

  const finish = useCallback((kind: "skip" | "complete") => {
    if (endedRef.current) return;
    const current = phaseRef.current;
    if (current.status !== "running" && current.status !== "seeking") return;
    endedRef.current = true;
    const step = current.status === "running" ? (currentTourStep(current) ?? "practice_tap") : "practice_tap";
    const store = browserLocalStorage();
    if (store) writeTourSeen(store);
    if (kind === "skip") logFunnelEvent("tour_skipped", "vote", { step });
    else logFunnelEvent("tour_completed", "vote");
    setWelcomeTourActive(false);
    setPhase({ status: "idle" });
  }, []);

  const skip = useCallback(() => finish("skip"), [finish]);
  const complete = useCallback(() => finish("complete"), [finish]);

  const begin = useCallback((source: TourSource) => {
    endedRef.current = false;
    const store = browserLocalStorage();
    if (store) armTourRealVote(store);
    logFunnelEvent("tour_started", "vote", { source });
    setWelcomeTourActive(true);
    setMeasured(null);
    setPracticeLive(false);
    setPhase(startRunning(source, true));
  }, []);

  useEffect(() => {
    const onRequest = () => {
      const source = takeTourRequest();
      if (!source) return;
      begin(source);
    };
    const unsubscribe = subscribeTourRequest(onRequest);
    onRequest();
    return () => {
      unsubscribe();
      setWelcomeTourActive(false);
    };
  }, [begin]);

  const step = currentTourStep(phase);

  useEffect(() => {
    const active = phase.status === "running" || phase.status === "seeking";
    if (!active) return;
    document.documentElement.dataset.welcomeTour = "on";
    return () => {
      delete document.documentElement.dataset.welcomeTour;
    };
  }, [phase.status]);

  useEffect(() => {
    if (!step) return;
    logFunnelEvent("tour_step_viewed", "vote", { step });
  }, [step]);

  useEffect(() => {
    if (phase.status !== "running" || !step) {
      setMeasured(null);
      setPracticeLive(false);
      return;
    }
    const measuredStep = step;
    let cancel = false;
    let release = () => {};
    let tracker: ResizeObserver | null = null;
    const publish = (rect: RectBox | null) => {
      setMeasured((current) => {
        if (current?.step === measuredStep && sameBox(current.rect, rect)) return current;
        return { step: measuredStep, rect };
      });
    };
    const run = async () => {
      setPracticeLive(false);
      setMeasured(null);
      if (measuredStep === phase.steps[0]) {
        await delay(reduce ? 0 : 340);
        if (cancel) return;
      }
      await waitForSwipeCarouselGone();
      if (cancel) return;
      if (measuredStep === "categories") {
        window.dispatchEvent(new Event(VOTE_STICKY_BAND_REVEAL));
        await nextFrames(2);
        if (cancel) return;
      }
      let node = measureNode(measuredStep);
      if (node) await waitForLayoutStable(() => toBox(node), node);
      if (cancel) return;
      node = measureNode(measuredStep);
      const fixedNav = Boolean(node?.closest("[data-testid='nav-bottom']"));
      if (node && tourTargetScrolls(measuredStep) && !fixedNav) {
        if (measuredStep === "practice_reveal") {
          const delta = revealScrollDelta(node, bubbleHeightRef.current);
          if (Math.abs(delta) >= 2) {
            window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
            await waitForScrollSettle(reduce);
          }
        } else {
          const insets = readSafeAreaInsets(getComputedStyle(document.documentElement));
          const box = node.getBoundingClientRect();
          if (targetNeedsScroll(
            { top: box.top, bottom: box.bottom, height: box.height },
            window.innerHeight,
            insets.top,
            insets.bottom,
          )) {
            scrollElementIntoView(node, measuredStep === "categories" ? "start" : "center", reduce);
            await waitForScrollSettle(reduce);
            if (measuredStep === "categories") {
              window.dispatchEvent(new Event(VOTE_STICKY_BAND_REVEAL));
              await nextFrames(2);
            }
          }
        }
      }
      if (cancel) return;
      node = measureNode(measuredStep);
      await waitForCardImages(node);
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      if (cancel) return;
      node = measureNode(measuredStep);
      const rect = await waitForLayoutStable(() => measureStepTarget(measuredStep), node);
      await nextFrames(1);
      const again = measureStepTarget(measuredStep);
      if (cancel) return;
      publish(sameBox(rect, again) ? rect : again);
      const tracked = measureNode(measuredStep);
      if (tracked && typeof ResizeObserver !== "undefined") {
        tracker = new ResizeObserver(() => {
          if (cancel) return;
          const next = toBox(tracked);
          publish(next);
        });
        tracker.observe(tracked);
        if (tracked.parentElement) tracker.observe(tracked.parentElement);
      }
      release = lockDocumentScroll(document);
    };
    void run();
    return () => {
      cancel = true;
      tracker?.disconnect();
      release();
    };
  }, [phase.status, step, reduce, phase.status === "running" ? phase.steps[0] : null]);

  useEffect(() => {
    if (step !== "practice_tap" || measured?.step !== "practice_tap") {
      setPracticeLive(false);
      return;
    }
    const timer = window.setTimeout(() => setPracticeLive(true), 400);
    return () => window.clearTimeout(timer);
  }, [step, measured]);

  useEffect(() => {
    if (phase.status === "idle") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.status, skip]);

  const onPractice = useCallback((side: "a" | "b") => {
    const current = phaseRef.current;
    if (current.status !== "running" || currentTourStep(current) !== "practice_tap") return;
    const card = findPracticeCard(document);
    const split = readPracticeSplit(
      card?.getAttribute("data-option-a-percent"),
      card?.getAttribute("data-option-b-percent"),
    );
    // Practice only. Do not call a vote route, the anon budget, credits, or XP.
    logFunnelEvent("tour_practice_vote", "vote", { side, hasSplit: split != null });
    const moved = advanceTour({ ...current, side, split });
    if (moved.status === "done") {
      complete();
      return;
    }
    setPhase(moved);
  }, [complete]);

  const onNext = useCallback(() => {
    const current = phaseRef.current;
    if (current.status !== "running") return;
    const moved = advanceTour(current);
    if (moved.status === "done") {
      complete();
      return;
    }
    setPhase(moved);
  }, [complete]);

  if (phase.status === "running" && step && measured?.step !== step && typeof document !== "undefined") {
    return createPortal(
      <div className="fixed inset-0 z-[80]" data-testid="welcome-tour-pending">
        <button
          type="button"
          onClick={skip}
          data-testid="welcome-tour-skip"
          className="fixed z-[90] inline-flex h-11 min-w-[5.5rem] items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-lg"
          style={{
            right: "max(1rem, var(--safe-area-inset-right, 0px))",
            bottom: "max(1rem, var(--safe-area-inset-bottom, 0px))",
          }}
        >
          Skip
        </button>
      </div>,
      document.body,
    );
  }

  const showRun = phase.status === "running" && step != null && measured?.step === step;
  if (!showRun || typeof document === "undefined") return null;

  const running = phase.status === "running" ? phase : null;
  const split = running?.split ?? null;
  const rounded = split ? roundSplitTo100(split.a, split.b) : null;
  const rect = measured && measured.step === step ? measured.rect : null;
  const copy = step ? tourStepCopy(step, rounded) : { title: "One moment", body: "Finding a head-to-head card." };
  const spotlight = step != null && stepSpotlights(step) && rect != null;
  const holeRect = spotlight && rect
    ? step === "practice_reveal"
      ? { ...rect, height: rect.height + 76 }
      : rect
    : null;
  const targetForBubble = holeRect;

  return createPortal(
    <TourOverlay
      native={isNativeSurface() || isNativeApp()}
      reduce={reduce}
      rect={spotlight ? rect : null}
      reveal={step === "practice_reveal"}
      split={rounded}
      picked={running?.side ?? null}
      names={readSideNames()}
      finale={step === "ready"}
      avoid={step === "your_turn" ? rect : null}
      practice={step === "practice_tap" && practiceLive}
      onPractice={onPractice}
      title={copy.title}
      body={copy.body}
      announcement={step ? tourAnnouncement(step, rounded) : `${copy.title}. ${copy.body}`}
      steps={running?.steps ?? null}
      index={running?.index ?? 0}
      nextLabel={
        step === "practice_tap" && rect == null
          ? "Next"
          : step
            ? tourNextLabel(step)
            : null
      }
      target={targetForBubble}
      bubbleHeight={bubbleHeight}
      bubbleRef={bubbleRef}
      onSkip={skip}
      onNext={onNext}
      onMeasureHeight={(next) => {
        setBubbleHeight((current) => (current === BUBBLE_HEIGHT_ESTIMATE ? next : current));
      }}
    />,
    document.body,
  );
}

function TourOverlay({
  native,
  reduce,
  rect,
  reveal,
  split,
  picked,
  names,
  finale,
  avoid,
  practice,
  onPractice,
  title,
  body,
  announcement,
  steps,
  index,
  nextLabel,
  target,
  bubbleHeight,
  bubbleRef,
  onSkip,
  onNext,
  onMeasureHeight,
}: {
  native: boolean;
  reduce: boolean;
  rect: RectBox | null;
  reveal: boolean;
  split: RunningTour["split"];
  picked: "a" | "b" | null;
  names: { a: string; b: string } | null;
  finale: boolean;
  avoid: RectBox | null;
  practice: boolean;
  onPractice: (side: "a" | "b") => void;
  title: string;
  body: string;
  announcement: string;
  steps: readonly TourStepId[] | null;
  index: number;
  nextLabel: "Next" | "Done" | null;
  target: RectBox | null;
  bubbleHeight: number;
  bubbleRef: RefObject<HTMLDivElement>;
  onSkip: () => void;
  onNext: () => void;
  onMeasureHeight: (height: number) => void;
}) {
  const insets = readSafeAreaInsets(getComputedStyle(document.documentElement));
  const placement = placeBubble({
    target: finale ? null : target,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    bubbleWidth: bubbleWidthFor(window.innerWidth),
    bubbleHeight,
    insets,
    avoid: finale ? null : avoid,
  });

  const onMeasureRef = useRef(onMeasureHeight);
  onMeasureRef.current = onMeasureHeight;

  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!node) return;
    const next = Math.ceil(node.getBoundingClientRect().height);
    if (next > 0) onMeasureRef.current(next);
  }, [bubbleRef, title, body, placement.width]);

  useEffect(() => {
    bubbleRef.current?.focus({ preventScroll: true });
  }, [bubbleRef, title]);

  const hole = rect ? fitHole(rect, reveal, insets) : null;

  return (
    <div
      className="fixed inset-0 z-[80]"
      data-testid="welcome-tour"
      data-native={native ? "true" : "false"}
    >
      <div className="absolute inset-0" />
      {finale ? (
        <div className="pointer-events-none absolute inset-0 bg-slate-950/40 dark:bg-black/55" data-testid="welcome-tour-finale-dim" />
      ) : null}
      <AnimatePresence>
        {hole && !finale ? (
          <motion.div
            key="scrim"
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
          >
            <svg className="h-full w-full" aria-hidden>
              <defs>
                <mask id="welcome-tour-cutout">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="16" fill="black" />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                mask="url(#welcome-tour-cutout)"
                className="fill-slate-950/60 dark:fill-black/70"
              />
            </svg>
            <div
              className="absolute rounded-2xl ring-2 ring-cyan-500/80 shadow-[0_0_0_6px_rgba(6,182,212,0.16)] dark:ring-cyan-300/80"
              style={{ top: hole.y, left: hole.x, width: hole.w, height: hole.h }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {practice && rect ? (
        <>
          <PracticeSide
            side="a"
            label="Practice tap, left side"
            rect={rect}
            onPractice={onPractice}
          />
          <PracticeSide
            side="b"
            label="Practice tap, right side"
            rect={rect}
            onPractice={onPractice}
          />
        </>
      ) : null}
      {reveal && rect ? (
        <div
          className="pointer-events-none absolute z-[86] px-1"
          style={{ top: rect.top + rect.height + 10, left: rect.left + 12, width: Math.max(0, rect.width - 24) }}
        >
          <PracticeSplit split={split} picked={picked} names={names} />
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        aria-describedby="welcome-tour-body"
        tabIndex={-1}
        data-testid="welcome-tour-bubble"
        data-tour-allow-scroll=""
        data-side={placement.side}
        className="fixed z-[90] flex min-h-[240px] max-h-[calc(100dvh-var(--safe-area-inset-top,0px)-var(--safe-area-inset-bottom,0px)-1rem)] w-[304px] max-w-[calc(100vw-var(--safe-area-inset-left,0px)-var(--safe-area-inset-right,0px)-16px)] flex-col overflow-hidden rounded-2xl border border-cyan-500/35 bg-popover p-3.5 text-popover-foreground shadow-xl outline-none md:w-[320px] dark:border-cyan-400/30"
        style={{
          top: `max(${placement.top}px, calc(var(--safe-area-inset-top, 0px) + 8px))`,
          left: `max(${placement.left}px, calc(var(--safe-area-inset-left, 0px) + 8px))`,
          width: placement.width,
          maxWidth: "calc(100vw - var(--safe-area-inset-left, 0px) - var(--safe-area-inset-right, 0px) - 16px)",
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onSkip();
        }}
      >
        <h2 id="welcome-tour-title" className="text-sm font-semibold leading-snug text-foreground">
          {title}
        </h2>
        <p id="welcome-tour-body" className="mt-1 text-sm leading-snug text-muted-foreground">
          {body}
        </p>
        {steps ? (
          <>
            <p className="sr-only">{`Step ${index + 1} of ${steps.length}`}</p>
            <div className="mt-3 flex items-center justify-center gap-1.5" data-testid="welcome-tour-dots" aria-hidden="true">
              {steps.map((id, dot) => (
                <span
                  key={id}
                  className={cn(
                    "h-1.5 rounded-full",
                    dot === index ? "w-4 bg-cyan-600 dark:bg-cyan-300" : "w-1.5 bg-foreground/20",
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className="mt-auto flex h-11 shrink-0 items-center justify-between gap-3" data-testid="welcome-tour-actions">
          <button
            type="button"
            onClick={onSkip}
            data-testid="welcome-tour-skip"
            className="inline-flex h-11 min-w-[5.5rem] items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Skip
          </button>
          {nextLabel ? (
            <button
              type="button"
              onClick={onNext}
              data-testid="welcome-tour-next"
              className="inline-flex h-11 min-w-[7rem] items-center justify-center rounded-full bg-cyan-500 px-4 text-sm font-semibold text-white hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {nextLabel}
            </button>
          ) : (
            <span className="inline-flex h-11 min-w-[7rem] items-center justify-center text-sm font-medium text-foreground">Tap a side</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PracticeSide({
  side,
  label,
  rect,
  onPractice,
}: {
  side: "a" | "b";
  label: string;
  rect: RectBox;
  onPractice: (side: "a" | "b") => void;
}) {
  const width = rect.width / 2;
  const armed = useRef(false);
  return (
    <button
      type="button"
      data-testid={side === "a" ? "welcome-tour-practice-a" : "welcome-tour-practice-b"}
      aria-label={label}
      className="absolute z-[85] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      style={{
        top: rect.top,
        left: side === "a" ? rect.left : rect.left + width,
        width,
        height: rect.height,
      }}
      onPointerDown={(event) => {
        armed.current = true;
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        if (!armed.current) return;
        armed.current = false;
        event.preventDefault();
        event.stopPropagation();
        onPractice(side);
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}

function PracticeSplit({
  split,
  picked,
  names,
}: {
  split: RunningTour["split"];
  picked: "a" | "b" | null;
  names: { a: string; b: string } | null;
}) {
  return (
    <div className="rounded-xl border border-cyan-500/40 bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-cyan-300/30">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">Practice</p>
      {split ? (
        <>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full bg-gradient-to-r from-blue-600 to-blue-400", picked === "a" && "ring-2 ring-inset ring-white")}
              style={{ width: barWidth(split.a) }}
            />
            <div
              className={cn("h-full bg-gradient-to-r from-amber-400 to-amber-600", picked === "b" && "ring-2 ring-inset ring-white")}
              style={{ width: barWidth(split.b) }}
            />
          </div>
          <div className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums text-foreground">
            <span className={cn("min-w-0 truncate", picked === "a" ? "font-semibold text-blue-700 dark:text-blue-200" : "font-medium text-muted-foreground")}>
              {names?.a ? `${names.a} ` : ""}{split.a}%
            </span>
            <span className={cn("min-w-0 truncate text-right", picked === "b" ? "font-semibold text-amber-700 dark:text-amber-200" : "font-medium text-muted-foreground")}>
              {names?.b ? `${names.b} ` : ""}{split.b}%
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
