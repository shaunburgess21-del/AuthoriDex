/**
 * Quick Vote header toggle: hide / show cards the visitor has already voted
 * on. Glass icon button in the same skin as the search pill; amber when
 * active (the hub's hide-mine accent) with a count badge of hidden cards.
 *
 * On each toggle the button briefly expands to a label ("Hiding 12 voted" /
 * "Showing all") and recedes to the icon — the same recede pattern as the
 * Quick Vote pill — so the visitor gets confirmation without a toast over
 * the header X.
 *
 * Also hosts the one-time coach tip callout anchored below the button.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const LABEL_HOLD_MS = 1600;
const TIP_AUTO_DISMISS_MS = 5000;

export type HideVotedTipDismissReason = "accepted" | "dismissed" | "timeout";

export interface QuickVoteHideVotedToggleProps {
  enabled: boolean;
  hiddenCount: number;
  onToggle: () => void;
  /** Coach tip visible (controlled by the overlay). */
  tipOpen: boolean;
  onTipDismiss: (reason: HideVotedTipDismissReason) => void;
  /** Increment to play the one-shot amber pulse (tip shown). */
  pulseKey: number;
}

export function QuickVoteHideVotedToggle({
  enabled,
  hiddenCount,
  onToggle,
  tipOpen,
  onTipDismiss,
  pulseKey,
}: QuickVoteHideVotedToggleProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [labelVisible, setLabelVisible] = useState(false);
  const labelTimerRef = useRef<number | null>(null);
  const pulse = useAnimationControls();

  // Expanding confirmation label after each toggle.
  const prevEnabledRef = useRef(enabled);
  useEffect(() => {
    if (prevEnabledRef.current === enabled) return;
    prevEnabledRef.current = enabled;
    setLabelVisible(true);
    if (labelTimerRef.current != null) window.clearTimeout(labelTimerRef.current);
    labelTimerRef.current = window.setTimeout(() => {
      labelTimerRef.current = null;
      setLabelVisible(false);
    }, LABEL_HOLD_MS);
  }, [enabled]);
  useEffect(
    () => () => {
      if (labelTimerRef.current != null) window.clearTimeout(labelTimerRef.current);
    },
    [],
  );

  // One-shot pulse (tip appearing) — same amber pulse as the hub's Hidden toggle.
  useEffect(() => {
    if (pulseKey === 0) return;
    void pulse.start({
      scale: [1, 1.14, 1],
      boxShadow: [
        "0 0 0 0 rgba(245, 158, 11, 0)",
        "0 0 14px 2px rgba(245, 158, 11, 0.55)",
        "0 0 0 0 rgba(245, 158, 11, 0)",
      ],
      transition: { duration: 0.45, ease: "easeOut" },
    });
  }, [pulseKey, pulse]);

  // Tip lifecycle: auto-dismiss, dismiss on any tap outside the toggle.
  useEffect(() => {
    if (!tipOpen) return;
    const timer = window.setTimeout(() => onTipDismiss("timeout"), TIP_AUTO_DISMISS_MS);
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onTipDismiss("dismissed");
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [tipOpen, onTipDismiss]);

  const label = enabled
    ? `Hiding ${hiddenCount} voted`
    : "Showing all";
  const badge = enabled && hiddenCount > 0 && !labelVisible;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <motion.button
        type="button"
        animate={pulse}
        onClick={() => {
          if (tipOpen) onTipDismiss("accepted");
          onToggle();
        }}
        aria-pressed={enabled}
        aria-label={enabled ? `Show voted cards (${hiddenCount} hidden)` : "Hide voted cards"}
        data-interactive="true"
        data-testid="quick-vote-hide-voted-toggle"
        className={cn(
          "flex h-9 items-center rounded-full border px-2 text-sm font-medium shadow-2xl shadow-black/40 backdrop-blur-xl transition-colors active:scale-95",
          enabled
            ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
            : "border-white/15 bg-black/30 text-white/80 hover:text-white",
        )}
      >
        {enabled ? (
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <motion.span
          initial={false}
          animate={
            labelVisible
              ? { width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }
              : { width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }
          }
          transition={{ duration: labelVisible ? 0.2 : 0.35, ease: "easeOut" }}
          className="overflow-hidden whitespace-nowrap text-[13px]"
          aria-hidden
        >
          {label}
        </motion.span>
      </motion.button>

      {badge && (
        <span
          className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-black ring-2 ring-black/60"
          data-testid="quick-vote-hide-voted-count"
        >
          {hiddenCount > 99 ? "99+" : hiddenCount}
        </span>
      )}

      <AnimatePresence>
        {tipOpen && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute right-0 top-[calc(100%+10px)] z-30 w-[228px] rounded-xl border border-white/15 bg-black/80 p-3 text-left shadow-2xl shadow-black/50 backdrop-blur-xl"
            onClick={() => onTipDismiss("dismissed")}
            data-testid="quick-vote-hide-voted-tip"
          >
            <span
              aria-hidden
              className="absolute -top-[6px] right-[13px] h-3 w-3 rotate-45 border-l border-t border-white/15 bg-black/80"
            />
            <p className="text-[13px] font-medium leading-snug text-slate-100">
              Tip: hide cards you&apos;ve already voted on
            </p>
            <p className="mt-1 text-xs leading-snug text-white/60">
              Tap the eye to skip straight to what you haven&apos;t voted on yet.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
