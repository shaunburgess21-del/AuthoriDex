/**
 * Quick Vote host — mounted on Home and Vote. Owns:
 *  - the entry pill nudge (first-visit fast path; ~7s dwell OR first scroll,
 *    arbitrated via interruptArbiter so only one interrupt fires per session),
 *  - the QuickVoteOverlay open state + history pushState back-to-close,
 *  - the post-signup restore (AUTH_APPLY_QUICK_VOTE_ONCE_KEY),
 *  - the persistent bottom-right Quick Vote pill (mobile Home + Vote).
 *
 * Overlay is mobile-only (v1). On desktop the first-visit nudge deep-links to /vote.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewportOffset } from "@/hooks/useVisualViewportOffset";
import { useAuth } from "@/contexts/AuthContext";
import { QuickVoteOverlay } from "@/components/quick-vote/QuickVoteOverlay";
import {
  QUICK_VOTE_NUDGE_ID,
  QUICK_VOTE_NUDGE_LIFETIME_CAP,
  isQuickVoteNudgeEligible,
} from "@/lib/quickVoteNudge";
import {
  consumeInterrupt,
  dismissInterrupt,
  markInterruptActivated,
} from "@/lib/interruptArbiter";
import { AUTH_APPLY_QUICK_VOTE_ONCE_KEY } from "@/lib/authReturn";
import { logFunnelEvent } from "@/lib/funnelTelemetry";

const NUDGE_DWELL_MS = 7000;
/** Min. scroll movement before "first scroll" counts as an intent signal —
 * filters out programmatic scrolls and mobile address-bar resize events. */
const SCROLL_TRIGGER_DELTA_PX = 48;

/** Set once the visitor opens Quick Vote (pill, nudge, or restore). */
const QUICK_VOTE_OPENED_KEY = "voxdex_quick_vote_opened";
/** Session clock for the one labelled intro, shared across Home and Vote. */
const PILL_INTRO_AT_KEY = "voxdex_quick_vote_pill_intro_at";
/** Session flag so the later label pulse fires at most once. */
const PILL_REMINDER_SHOWN_KEY = "voxdex_quick_vote_pill_reminder_shown";
const PILL_INTRO_MS = 3000;
const PILL_REMINDER_DELAY_MS = 45000;
const PILL_REMINDER_HOLD_MS = 2500;

function hasOpenedQuickVote(): boolean {
  try {
    return localStorage.getItem(QUICK_VOTE_OPENED_KEY) === "1";
  } catch {
    return false;
  }
}

function markQuickVoteOpened(): void {
  try {
    localStorage.setItem(QUICK_VOTE_OPENED_KEY, "1");
  } catch {
    // Private mode — the pill just stays quiet this visit.
  }
}

function pillIntroAt(): number | null {
  try {
    const raw = sessionStorage.getItem(PILL_INTRO_AT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function pillReminderShown(): boolean {
  try {
    return sessionStorage.getItem(PILL_REMINDER_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

export interface QuickVoteHostProps {
  surface: "home" | "vote";
}

export function QuickVoteHost({ surface }: QuickVoteHostProps) {
  const isMobile = useIsMobile();
  // BottomNav translates itself by this signed delta to stay glued to the
  // visual viewport as the iOS toolbar shows/hides. The pills sit 16px above
  // the nav, so they must ride the same offset or the nav slides underneath
  // them on scroll-down (toolbar collapse) and they end up overlapping it.
  const viewportOffset = useVisualViewportOffset();
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlaySource, setOverlaySource] = useState<string>("unknown");
  const [initialCardId, setInitialCardId] = useState<string | undefined>(undefined);
  const [nudgeVisible, setNudgeVisible] = useState(false);

  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = overlayOpen;

  // ── Overlay open/close with history back-to-close (same as snap) ────────
  const openOverlay = useCallback((source: string, cardId?: string) => {
    if (overlayOpenRef.current) return;
    markQuickVoteOpened();
    setOverlaySource(source);
    setInitialCardId(cardId);
    setNudgeVisible(false);
    setOverlayOpen(true);
    window.history.pushState({ overlay: "quick-vote" }, "");
  }, []);

  const closeOverlay = useCallback(() => {
    // popstate handler flips state; keeps history depth consistent.
    window.history.back();
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (overlayOpenRef.current) {
        setOverlayOpen(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Body scroll lock while the overlay is up (host may live outside VotePage's
  // own overlay lock effect).
  useEffect(() => {
    if (!overlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlayOpen]);

  // ── Post-signup restore (consume-once) ─────────────────────────────────
  useEffect(() => {
    if (authLoading || !isMobile) return;
    let payload: { cardId?: string | null } | null = null;
    try {
      const raw = sessionStorage.getItem(AUTH_APPLY_QUICK_VOTE_ONCE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(AUTH_APPLY_QUICK_VOTE_ONCE_KEY);
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    openOverlay("restore", payload?.cardId ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isMobile]);

  // ── Entry pill nudge: ~7s dwell OR first meaningful scroll ──────────────
  useEffect(() => {
    if (authLoading || user) return;
    if (overlayOpen || nudgeVisible) return;
    // Desktop pill deep-links to /vote — pointless on /vote itself.
    if (!isMobile && surface === "vote") return;
    if (!isQuickVoteNudgeEligible(!!user)) return;

    let fired = false;
    const armScrollY = window.scrollY;
    const trigger = () => {
      if (fired || overlayOpenRef.current) return;
      fired = true;
      cleanup();
      // Re-check at fire time — the visitor may have voted during the dwell.
      if (!isQuickVoteNudgeEligible(false)) return;
      if (!consumeInterrupt(QUICK_VOTE_NUDGE_ID, QUICK_VOTE_NUDGE_LIFETIME_CAP)) return;
      setNudgeVisible(true);
      logFunnelEvent("nudge_impression", "quick_vote", { surface });
    };
    const onScroll = () => {
      if (Math.abs(window.scrollY - armScrollY) < SCROLL_TRIGGER_DELTA_PX) return;
      trigger();
    };
    const timer = window.setTimeout(trigger, NUDGE_DWELL_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, overlayOpen, surface, isMobile]);

  const showFab = isMobile && !overlayOpen && !nudgeVisible;

  // Warm the mix + hydration caches while the FAB is on screen so the
  // overlay opens with cards already in hand.
  useEffect(() => {
    if (!showFab) return;
    void queryClient.prefetchQuery({
      queryKey: ["/api/vote/starter-mix"],
      staleTime: 5 * 60 * 1000,
    });
    for (const key of ["/api/matchups", "/api/trending-polls", "/api/opinion-polls"]) {
      void queryClient.prefetchQuery({ queryKey: [key], staleTime: 60 * 1000 });
    }
  }, [showFab, queryClient]);

  const acceptNudge = useCallback(() => {
    markInterruptActivated(QUICK_VOTE_NUDGE_ID);
    logFunnelEvent("nudge_accept", "quick_vote", { surface, device: isMobile ? "mobile" : "desktop" });
    setNudgeVisible(false);
    if (isMobile) {
      openOverlay("nudge_pill");
    } else {
      setLocation("/vote");
    }
  }, [isMobile, openOverlay, setLocation, surface]);

  const dismissNudge = useCallback(() => {
    dismissInterrupt(QUICK_VOTE_NUDGE_ID);
    logFunnelEvent("nudge_dismiss", "quick_vote", { surface });
    setNudgeVisible(false);
  }, [surface]);

  const openFromFab = useCallback(() => {
    openOverlay("persistent_pill");
  }, [openOverlay]);

  // The pill stays mounted and tappable, collapsed to a dim icon. The full
  // "Quick Vote" label shows once at the start of a session (3s), then once
  // more ~45s later if they still haven't opened it. Scrolling never expands it.
  // Visitors who have opened Quick Vote stay on the icon.
  const [pillProminent, setPillProminent] = useState(false);
  useLayoutEffect(() => {
    if (!showFab || hasOpenedQuickVote()) {
      setPillProminent(false);
      return;
    }

    const timers: number[] = [];
    let started = pillIntroAt();
    if (started == null) {
      started = Date.now();
      try {
        sessionStorage.setItem(PILL_INTRO_AT_KEY, String(started));
      } catch {
        // Private mode — intro still plays, it just won't be shared across pages.
      }
    }

    const introRemaining = PILL_INTRO_MS - (Date.now() - started);
    if (introRemaining > 0) {
      setPillProminent(true);
      timers.push(window.setTimeout(() => setPillProminent(false), introRemaining));
    } else {
      setPillProminent(false);
    }

    if (!pillReminderShown()) {
      const wait = Math.max(0, started + PILL_REMINDER_DELAY_MS - Date.now());
      timers.push(window.setTimeout(() => {
        if (hasOpenedQuickVote()) return;
        try {
          sessionStorage.setItem(PILL_REMINDER_SHOWN_KEY, "1");
        } catch {
          // Still show the pulse; a later page in this session may repeat it.
        }
        setPillProminent(true);
        timers.push(window.setTimeout(() => setPillProminent(false), PILL_REMINDER_HOLD_MS));
      }, wait));
    }

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [showFab]);

  return (
    <>
      {/* Entry pill nudge — bottom, above BottomNav (h-16, z-50). The outer
          div owns fixed positioning + the visual-viewport translate (kept off
          the motion element so it can't fight Framer's own y transform).
          The nav's height grows by env(safe-area-inset-bottom) when the
          browser toolbar hides (its top edge rises), so the pill's bottom
          offset must ride the same inset to keep a constant 16px gap. */}
      <div
        className="fixed inset-x-0 bottom-20 md:bottom-6 z-[55] pointer-events-none"
        style={{
          ...(isMobile
            ? { bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }
            : {}),
          transform: viewportOffset !== 0 ? `translateY(${viewportOffset}px)` : undefined,
          willChange: "transform",
        }}
      >
        <AnimatePresence>
          {nudgeVisible && !overlayOpen && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex justify-center px-4 pointer-events-none"
            >
              <div
                className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-black/30 pl-4 pr-1.5 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
                data-testid="quick-vote-nudge-pill"
              >
                <span className="text-sm text-slate-200">New here?</span>
                <button
                  onClick={acceptNudge}
                  className="ml-1 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
                  data-testid="quick-vote-nudge-accept"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Cast your first vote
                </button>
                <button
                  onClick={dismissNudge}
                  className="p-1.5 text-slate-400 transition-colors hover:text-slate-200"
                  aria-label="Dismiss"
                  data-testid="quick-vote-nudge-dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Persistent Quick Vote pill (mobile). Same fixed wrapper pattern as
          the nudge pill so it tracks the nav — including the safe-area inset
          the nav's height grows by. Hidden while the overlay or first-visit
          nudge is up. */}
      <div
        className="fixed right-4 z-[55] pointer-events-none"
        style={{
          bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
          transform: viewportOffset !== 0 ? `translateY(${viewportOffset}px)` : undefined,
          willChange: "transform",
        }}
      >
        <AnimatePresence>
          {showFab && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              // Labelled only for the session intro and one later reminder.
              // Otherwise a dim icon circle. Always tappable.
              animate={{ opacity: pillProminent ? 1 : 0.5, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: pillProminent ? 0.2 : 0.45, ease: "easeOut" }}
              onClick={openFromFab}
              className="pointer-events-auto flex items-center rounded-full border border-white/15 bg-black/30 p-2.5 text-sm font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform active:scale-95"
              aria-label="Quick Vote"
              data-testid="quick-vote-reentry-pill"
            >
              <Zap className="h-4 w-4 shrink-0 text-primary" />
              <motion.span
                initial={false}
                animate={
                  pillProminent
                    ? { width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }
                    : { width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }
                }
                transition={{ duration: pillProminent ? 0.2 : 0.45, ease: "easeOut" }}
                className="overflow-hidden whitespace-nowrap"
              >
                Quick Vote
              </motion.span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {isMobile && (
        <QuickVoteOverlay
          open={overlayOpen}
          onClose={closeOverlay}
          initialCardId={initialCardId}
          source={overlaySource}
        />
      )}
    </>
  );
}
