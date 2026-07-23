/**
 * Quick Vote host — mounted on Home and Vote. Owns:
 *  - the entry pill nudge (first-visit fast path; ~7s dwell OR first scroll,
 *    arbitrated via interruptArbiter so only one interrupt fires per session),
 *  - the QuickVoteOverlay open state + history pushState back-to-close,
 *  - the post-signup restore (AUTH_APPLY_QUICK_VOTE_ONCE_KEY),
 *  - the session re-entry pill after the overlay is closed.
 *
 * Overlay is mobile-only (v1). On desktop the same pill deep-links to /vote.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
const REENTRY_SESSION_KEY = "voxdex_quick_vote_reentry";

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
  const [reentryVisible, setReentryVisible] = useState(
    () => {
      try {
        return sessionStorage.getItem(REENTRY_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    },
  );

  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = overlayOpen;

  // ── Overlay open/close with history back-to-close (same as snap) ────────
  const openOverlay = useCallback((source: string, cardId?: string) => {
    if (overlayOpenRef.current) return;
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
        try {
          sessionStorage.setItem(REENTRY_SESSION_KEY, "1");
        } catch {
          /* private mode */
        }
        setReentryVisible(true);
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
    if (overlayOpen || nudgeVisible || reentryVisible) return;
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
  }, [authLoading, user, overlayOpen, reentryVisible, surface, isMobile]);

  // Warm the mix + hydration caches while the pill is on screen so the
  // overlay opens with cards already in hand.
  useEffect(() => {
    if (!nudgeVisible || !isMobile) return;
    void queryClient.prefetchQuery({
      queryKey: ["/api/vote/starter-mix"],
      staleTime: 5 * 60 * 1000,
    });
    for (const key of ["/api/matchups", "/api/trending-polls", "/api/opinion-polls"]) {
      void queryClient.prefetchQuery({ queryKey: [key], staleTime: 60 * 1000 });
    }
  }, [nudgeVisible, isMobile, queryClient]);

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

  const openFromReentry = useCallback(() => {
    openOverlay("reentry_pill");
  }, [openOverlay]);

  const showReentry = reentryVisible && isMobile && !overlayOpen && !nudgeVisible;

  return (
    <>
      {/* Entry pill nudge — bottom, above BottomNav (h-16, z-50). The outer
          div owns fixed positioning + the visual-viewport translate (kept off
          the motion element so it can't fight Framer's own y transform). */}
      <div
        className="fixed inset-x-0 bottom-20 md:bottom-6 z-[55] pointer-events-none"
        style={{
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
                className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-white/10 pl-4 pr-1.5 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
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

      {/* Session re-entry pill after overlay close (mobile). Same fixed
          wrapper pattern as the nudge pill so it tracks the nav. */}
      <div
        className="fixed bottom-20 right-4 z-[55] pointer-events-none"
        style={{
          transform: viewportOffset !== 0 ? `translateY(${viewportOffset}px)` : undefined,
          willChange: "transform",
        }}
      >
        <AnimatePresence>
          {showReentry && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={openFromReentry}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform active:scale-95"
              data-testid="quick-vote-reentry-pill"
            >
              <Zap className="h-4 w-4 text-primary" />
              Quick Vote
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
