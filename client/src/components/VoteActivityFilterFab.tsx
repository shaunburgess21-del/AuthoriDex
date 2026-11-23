/**
 * Mobile hub filter pill. On Vote it stacks above Quick Vote; on Predict it
 * floats alone in the same corner. Cycles all → not yet acted → mine only.
 * The label expands inside the pill during the shared corner intro and again
 * briefly after each tap, then collapses to a dim eye — the same slide-out
 * and recede as the Quick Vote and Ask VoxDex pills.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCornerPillIntro } from "@/lib/cornerPillIntro";
import {
  formatActivityFilterCount,
  hubActivityFilterFabAriaLabel,
  hubActivityFilterFabLabel,
  type HubActivityFilter,
  type HubActivityFilterScope,
} from "@/lib/hub-activity-filter";

const LABEL_HOLD_MS = 1600;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Fixed-width count so 8 and 999 occupy the same box. Pulses when it falls. */
export function ActivityFilterCountBadge({
  count,
  className,
  testId,
}: {
  count: number;
  className?: string;
  testId?: string;
}) {
  const previous = useRef(count);
  const [dropTick, setDropTick] = useState(0);

  useEffect(() => {
    if (count < previous.current && !prefersReducedMotion()) {
      setDropTick((tick) => tick + 1);
    }
    previous.current = count;
  }, [count]);

  return (
    <span
      key={dropTick}
      className={cn(
        "inline-flex h-[18px] min-w-[2.75rem] items-center justify-center whitespace-nowrap rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none",
        dropTick > 0 && "activity-count-drop",
        className,
      )}
      data-testid={testId}
    >
      {formatActivityFilterCount(count)}
    </span>
  );
}

export interface VoteActivityFilterFabProps {
  scope?: HubActivityFilterScope;
  value: HubActivityFilter;
  count: number;
  /**
   * Voted cards, used only to describe the next tap. The badge `count` in
   * Not voted mode is the cards still open, which is a different number.
   */
  ownedCount?: number;
  onCycle: () => void;
  /** Increments when a hide-mine card finishes flying out, so the pill pulses. Vote only. */
  pulseTick?: number;
}

export function VoteActivityFilterFab({
  scope = "vote",
  value,
  count,
  ownedCount,
  onCycle,
  pulseTick = 0,
}: VoteActivityFilterFabProps) {
  const [tapLabelVisible, setTapLabelVisible] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const timerRef = useRef<number | null>(null);
  const pulse = useAnimationControls();
  // Vote and Predict count as separate pills, so the first visit to each
  // page still gets an intro.
  const introVisible = useCornerPillIntro(scope === "predict" ? "predict-eye" : "vote-eye", true);
  const labelVisible = introVisible || tapLabelVisible;

  const revealFor = useCallback((ms: number) => {
    setTapLabelVisible(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setTapLabelVisible(false);
    }, ms);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Tap confirmation: the new state's label expands, then recedes.
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    revealFor(LABEL_HOLD_MS);
    setLiveMessage(hubActivityFilterFabAriaLabel(scope, value, count, ownedCount));
  }, [value, revealFor, scope, count, ownedCount]);

  const seenTickRef = useRef(pulseTick);
  useEffect(() => {
    if (pulseTick === seenTickRef.current) return;
    seenTickRef.current = pulseTick;
    if (pulseTick === 0) return;
    void pulse.start({
      scale: [1, 1.14, 1],
      boxShadow: [
        "0 0 0 0 rgba(245, 158, 11, 0)",
        "0 0 14px 2px rgba(245, 158, 11, 0.55)",
        "0 0 0 0 rgba(245, 158, 11, 0)",
      ],
      transition: { duration: 0.45, ease: "easeOut" },
    });
  }, [pulseTick, pulse]);

  const label = hubActivityFilterFabLabel(scope, value);
  const showBadge = !labelVisible && value !== "all" && count > 0;
  const testId = scope === "predict" ? "predict-activity-filter-fab" : "vote-activity-filter-fab";

  return (
    <motion.div animate={pulse} className="pointer-events-auto relative flex flex-col items-end">
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid={`${testId}-live`}
      >
        {liveMessage}
      </span>
      <div className="relative">
        <motion.button
          type="button"
          onClick={onCycle}
          initial={false}
          animate={{ opacity: labelVisible ? 1 : 0.5 }}
          transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
          className="pointer-events-auto relative flex items-center rounded-full border border-white/15 bg-black/30 p-2.5 text-sm font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform active:scale-95"
          aria-label={hubActivityFilterFabAriaLabel(scope, value, count, ownedCount)}
          data-testid={testId}
        >
          {value === "hide-mine" ? (
            <EyeOff className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          ) : (
            <Eye
              className={cn(
                "h-4 w-4 shrink-0",
                value === "show-mine"
                  ? scope === "predict"
                    ? "text-violet-400"
                    : "text-cyan-400"
                  : "text-slate-100",
              )}
              aria-hidden
            />
          )}
          {/* leading-4 matches the 16px icon so the open pill stays the same
              height as the round button and the pills above and below do not jump. */}
          <motion.span
            initial={false}
            animate={
              labelVisible
                ? { width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }
                : { width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }
            }
            transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
            className="overflow-hidden whitespace-nowrap leading-4"
            aria-hidden
            data-testid={`${testId}-label`}
          >
            {label}
          </motion.span>
        </motion.button>

        {showBadge && (
          <ActivityFilterCountBadge
            count={count}
            testId={scope === "predict" ? "predict-activity-filter-count" : "vote-activity-filter-count"}
            className={cn(
              "pointer-events-none absolute -right-1 -top-1 ring-2 ring-black/60",
              value === "hide-mine"
                ? "bg-amber-500 text-black"
                : scope === "predict"
                  ? "bg-violet-400 text-black"
                  : "bg-cyan-400 text-black",
            )}
          />
        )}
      </div>
    </motion.div>
  );
}
