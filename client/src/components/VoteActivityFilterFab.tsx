/**
 * Mobile hub filter pill. On Vote it sits beside Quick Vote; on Predict it
 * floats alone in the same corner. Cycles all → not yet acted → mine only.
 * The label shows for the session intro and again briefly after each tap,
 * then collapses to a dim eye — the same recede as the Quick Vote pill.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hubActivityFilterFabAriaLabel,
  hubActivityFilterFabLabel,
  type HubActivityFilter,
  type HubActivityFilterScope,
} from "@/lib/hub-activity-filter";

const INTRO_AT_KEY: Record<HubActivityFilterScope, string> = {
  vote: "voxdex_vote_filter_pill_intro_at",
  predict: "voxdex_predict_filter_pill_intro_at",
};
const INTRO_MS = 3000;
const LABEL_HOLD_MS = 1600;

export interface VoteActivityFilterFabProps {
  scope?: HubActivityFilterScope;
  value: HubActivityFilter;
  count: number;
  onCycle: () => void;
  /** Increments when a hide-mine card finishes flying out, so the pill pulses. Vote only. */
  pulseTick?: number;
}

export function VoteActivityFilterFab({
  scope = "vote",
  value,
  count,
  onCycle,
  pulseTick = 0,
}: VoteActivityFilterFabProps) {
  const [labelVisible, setLabelVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pulse = useAnimationControls();

  const revealFor = useCallback((ms: number) => {
    setLabelVisible(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setLabelVisible(false);
    }, ms);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Label shows once at the start of a session, then collapses. Remounts
  // (overlay open/close) only finish whatever time is left. Vote and Predict
  // keep separate clocks so opening one page does not spend the other's intro.
  const introKey = INTRO_AT_KEY[scope];
  useLayoutEffect(() => {
    let started: number | null = null;
    try {
      const raw = sessionStorage.getItem(introKey);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n)) started = n;
      }
    } catch {
      // Private mode — intro still plays, it just won't be shared across pages.
    }

    if (started == null) {
      started = Date.now();
      try {
        sessionStorage.setItem(introKey, String(started));
      } catch {
        // Private mode.
      }
    }

    const remaining = INTRO_MS - (Date.now() - started);
    if (remaining > 0) revealFor(remaining);
  }, [introKey, revealFor]);

  // Tap confirmation: the new state's label expands, then recedes.
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    revealFor(LABEL_HOLD_MS);
  }, [value, revealFor]);

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
    <motion.div animate={pulse} className="relative">
      <motion.button
        type="button"
        onClick={onCycle}
        initial={false}
        animate={{ opacity: labelVisible ? 1 : 0.5 }}
        transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
        className="pointer-events-auto flex items-center rounded-full border border-white/15 bg-black/30 p-2.5 text-sm font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform active:scale-95"
        aria-label={hubActivityFilterFabAriaLabel(scope, value, count)}
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
        <motion.span
          initial={false}
          animate={
            labelVisible
              ? { width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }
              : { width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }
          }
          transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
          className="overflow-hidden whitespace-nowrap"
          aria-hidden
        >
          {label}
        </motion.span>
      </motion.button>

      {showBadge && (
        <span
          className={cn(
            "pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ring-2 ring-black/60",
            value === "hide-mine"
              ? "bg-amber-500 text-black"
              : scope === "predict"
                ? "bg-violet-400 text-black"
                : "bg-cyan-400 text-black",
          )}
          data-testid={scope === "predict" ? "predict-activity-filter-count" : "vote-activity-filter-count"}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </motion.div>
  );
}
