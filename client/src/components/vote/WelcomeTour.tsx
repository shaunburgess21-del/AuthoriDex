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
  PRACTICE_CARD_WAIT_MS,
  PREDICT_NAV_TEST_IDS,
  RANKINGS_NAV_TEST_IDS,
  WELCOME_TOUR_CARD_ATTR,
  advanceTour,
  armTourRealVote,
  currentTourStep,
  lockDocumentScroll,
  pickVisibleId,
  formatLivePercent,
  placeBubble,
  readPracticeSplit,
  readSafeAreaInsets,
  rectNeedsScroll,
  seekTour,
  setWelcomeTourActive,
  shouldSkipPractice,
  startRunning,
  stepSpotlights,
  subscribeTourRequest,
  takeTourRequest,
  tourAnnouncement,
  tourNextLabel,
  tourStepCopy,
  writeTourSeen,
  type RectBox,
  type RunningTour,
  type TourPhase,
  type TourSource,
  type TourStepId,
} from "@/lib/welcomeTour";

const BUBBLE_WIDTH = 304;
const BUBBLE_HEIGHT_ESTIMATE = 188;

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

function visibleEmptyFeed(root: ParentNode): boolean {
  const empty = root.querySelector<HTMLElement>("[data-testid='vote-mixed-feed-empty']");
  return Boolean(empty && empty.getClientRects().length > 0);
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

function measureStepTarget(step: TourStepId): RectBox | null {
  if (!stepSpotlights(step)) return null;
  if (step === "practice_tap" || step === "practice_reveal") return toBox(findPracticeCard(document));
  if (step === "categories") return toBox(findVisibleByTestId(document, CATEGORY_BAND_TEST_ID));
  if (step === "predict") return toBox(firstVisible(document, PREDICT_NAV_TEST_IDS));
  if (step === "rankings") return toBox(firstVisible(document, RANKINGS_NAV_TEST_IDS));
  return null;
}

function scrollTourTarget(element: HTMLElement, reduceMotion: boolean): Promise<void> {
  element.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
  if (reduceMotion) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  return new Promise((resolve) => {
    const started = performance.now();
    let timer = window.setTimeout(finish, 80);
    const onScroll = () => {
      if (performance.now() - started > 700) {
        finish();
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, 90);
    };
    function finish() {
      window.removeEventListener("scroll", onScroll);
      resolve();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  });
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
  const [seekVisible, setSeekVisible] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const bubbleRef = useRef<HTMLDivElement>(null);
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
    setPhase(seekTour(source));
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

  useEffect(() => {
    if (phase.status !== "seeking") {
      setSeekVisible(false);
      return;
    }
    const source = phase.source;
    let cancel = false;
    const started = performance.now();
    let timer = 0;
    const show = window.setTimeout(() => {
      if (!cancel) setSeekVisible(true);
    }, 280);
    const tick = () => {
      if (cancel) return;
      const card = findPracticeCard(document);
      const waited = performance.now() - started;
      if (
        card ||
        shouldSkipPractice({
          cardFound: Boolean(card),
          waitedMs: waited,
          feedEmpty: visibleEmptyFeed(document),
          waitMs: PRACTICE_CARD_WAIT_MS,
        })
      ) {
        setPhase(startRunning(source, Boolean(card)));
        return;
      }
      timer = window.setTimeout(tick, 120);
    };
    tick();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      window.clearTimeout(show);
    };
  }, [phase]);

  const step = currentTourStep(phase);

  useEffect(() => {
    if (!step) return;
    logFunnelEvent("tour_step_viewed", "vote", { step });
  }, [step]);

  useEffect(() => {
    if (phase.status !== "running") return;
    let cancel = false;
    let release = () => {};
    const run = async () => {
      const card = findPracticeCard(document);
      if (card && phase.steps[0] === "practice_tap") {
        const insets = readSafeAreaInsets(getComputedStyle(document.documentElement));
        if (rectNeedsScroll(card.getBoundingClientRect(), window.innerHeight, insets.top)) {
          await scrollTourTarget(card, reduce);
        }
        window.dispatchEvent(new Event(VOTE_STICKY_BAND_REVEAL));
      }
      if (cancel) return;
      release = lockDocumentScroll(document);
    };
    void run();
    return () => {
      cancel = true;
      release();
    };
  }, [phase.status, reduce, phase.status === "running" ? phase.steps[0] : null]);

  useEffect(() => {
    if (phase.status !== "running" || step !== "categories") return;
    window.dispatchEvent(new Event(VOTE_STICKY_BAND_REVEAL));
  }, [phase.status, step]);

  useEffect(() => {
    if (phase.status !== "running" || !step) {
      setMeasured(null);
      return;
    }
    const measuredStep = step;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = measureStepTarget(measuredStep);
        setMeasured((current) => {
          if (current && current.step === measuredStep && sameBox(current.rect, rect)) return current;
          return { step: measuredStep, rect };
        });
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [phase.status, step]);

  useEffect(() => {
    if (phase.status !== "running") return;
    if (step !== "practice_tap" && step !== "practice_reveal") return;
    if (findPracticeCard(document)) return;
    setPhase(startRunning(phase.source, false));
  }, [phase, step]);

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

  const showSeek = phase.status === "seeking" && seekVisible;
  const showRun = phase.status === "running" && step != null;
  if ((!showSeek && !showRun) || typeof document === "undefined") return null;

  const running = phase.status === "running" ? phase : null;
  const split = running?.split ?? null;
  const rect = measured && measured.step === step ? measured.rect : null;
  const copy = step ? tourStepCopy(step, split) : { title: "One moment", body: "Finding a head-to-head card." };
  const spotlight = step != null && stepSpotlights(step) && rect != null;
  const targetForBubble: RectBox | null =
    spotlight && rect
      ? step === "practice_reveal"
        ? { ...rect, height: rect.height + 76 }
        : rect
      : null;

  return createPortal(
    <TourOverlay
      native={isNativeSurface() || isNativeApp()}
      reduce={reduce}
      rect={spotlight ? rect : null}
      reveal={step === "practice_reveal"}
      split={split}
      practice={step === "practice_tap"}
      onPractice={onPractice}
      title={copy.title}
      body={copy.body}
      announcement={step ? tourAnnouncement(step, split) : `${copy.title}. ${copy.body}`}
      steps={running?.steps ?? null}
      index={running?.index ?? 0}
      nextLabel={step ? tourNextLabel(step) : null}
      target={targetForBubble}
      bubbleHeight={bubbleHeight}
      bubbleRef={bubbleRef}
      onSkip={skip}
      onNext={onNext}
      onMeasureHeight={(next) => {
        setBubbleHeight((current) => (Math.abs(current - next) > 1 ? next : current));
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
    target,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    bubbleWidth: BUBBLE_WIDTH,
    bubbleHeight,
    insets,
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

  const hole = rect
    ? {
        x: rect.left - 8,
        y: rect.top - 8,
        w: rect.width + 16,
        h: rect.height + 16 + (reveal ? 76 : 0),
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-[80]"
      data-testid="welcome-tour"
      data-native={native ? "true" : "false"}
    >
      <div className="absolute inset-0" />
      <AnimatePresence>
        {hole ? (
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
          <PracticeSplit split={split} />
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
        className="fixed z-[90] max-h-[calc(100dvh-var(--safe-area-inset-top,0px)-var(--safe-area-inset-bottom,0px)-1rem)] overflow-auto rounded-2xl border border-cyan-500/35 bg-popover p-3.5 text-popover-foreground shadow-xl outline-none dark:border-cyan-400/30"
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
          <div className="mt-3 flex items-center justify-center gap-1.5" data-testid="welcome-tour-dots" aria-hidden>
            {steps.map((id, dot) => (
              <span
                key={id}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none",
                  dot === index ? "w-4 bg-cyan-600 dark:bg-cyan-300" : "w-1.5 bg-foreground/20",
                )}
              />
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            data-testid="welcome-tour-skip"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Skip
          </button>
          {nextLabel ? (
            <button
              type="button"
              onClick={onNext}
              data-testid="welcome-tour-next"
              className="inline-flex min-h-11 items-center rounded-full bg-cyan-500 px-4 text-sm font-semibold text-white hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {nextLabel}
            </button>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">Tap a side</span>
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
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPractice(side);
      }}
    />
  );
}

function PracticeSplit({ split }: { split: RunningTour["split"] }) {
  return (
    <div className="rounded-xl border border-cyan-500/40 bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-cyan-300/30">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">Practice</p>
      {split ? (
        <>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400" style={{ width: barWidth(split.a) }} />
            <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: barWidth(split.b) }} />
          </div>
          <div className="mt-1 flex justify-between text-xs font-medium tabular-nums text-foreground">
            <span>{formatLivePercent(split.a)}%</span>
            <span>{formatLivePercent(split.b)}%</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
