import { Suspense, useEffect, useRef, useState } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemedToaster } from "@/components/ThemedToaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomNav } from "@/components/BottomNav";
import { HelpChat } from "@/components/help-chat/HelpChat";
import { SiteBanner } from "@/components/SiteBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Footer } from "@/components/Footer";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { ScrollToTop } from "@/components/ScrollToTop";
import { XpBurstProvider } from "@/components/XpBurstProvider";
import { ShareCardProvider } from "@/contexts/ShareCardContext";
import { ReferralModalProvider } from "@/components/referral/ReferralModalProvider";
import { ReferralPromptGate } from "@/components/referral/ReferralPromptGate";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteHeader } from "@/components/SiteHeader";
import { LeaderboardRowSkeleton } from "@/components/ui/card-skeletons";
import { AnonFirstVoteNudge } from "@/components/AnonFirstVoteNudge";
import { getAuthHeaders } from "@/lib/queryClient";
import { useDailyCheckin, useXpCelebration } from "@/hooks/useGamification";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { RANK_UP_EVENT, type RankUpPayload } from "@/lib/rank-up-events";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { NEW_USER_GATE_ALLOWLIST as NEW_USER_GATE_ALLOWLIST_PATHS } from "@shared/public-paths";
import { initGoogleAnalytics, trackGooglePageView } from "@/lib/analytics";
import { trackPageLand } from "@/lib/funnelTelemetry";
import {
  captureReferralFromUrl,
  captureShareClickFromUrl,
} from "@/lib/referral-capture";
import { registerNativeContentNavigator } from "@/lib/nativeDeepLinks";
import { shouldShowCelebrationToasts } from "@/lib/onboarding-toasts";
import { setHideHintRecommendations } from "@/lib/hideHintGate";
import { shouldOpenInterestsPrompt } from "@/lib/interestsPrompt";
import { StickyChromeFocusGuard } from "@/components/StickyChromeFocusGuard";
import {
  leaderboardAliasTarget,
  legacyLeaderboardShareTarget,
  primaryNavKeyForPath,
} from "@/lib/primaryNav";

if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

const HomePage = lazyWithRetry(() => import("@/pages/HomePage"));
const PersonDetailPage = lazyWithRetry(() => import("@/pages/PersonDetailPage"));
const LoginPage = lazyWithRetry(() => import("@/pages/LoginPage"));
const VerifyPage = lazyWithRetry(() => import("@/pages/auth/VerifyPage"));
const WelcomePage = lazyWithRetry(() => import("@/pages/auth/WelcomePage"));
const TermsPage = lazyWithRetry(() => import("@/pages/TermsPage"));
const PrivacyPage = lazyWithRetry(() => import("@/pages/PrivacyPage"));
const AccountDeletionPage = lazyWithRetry(() => import("@/pages/AccountDeletionPage"));
const TakedownPage = lazyWithRetry(() => import("@/pages/TakedownPage"));
// RefundPolicyPage / PricingPage / CheckoutPage are intentionally not
// routed while VoxDex runs free-to-play (no payment provider yet). The
// page components are kept in the repo for when purchases return; the
// old URLs redirect below so external links don't 404.
const ContactPage = lazyWithRetry(() => import("@/pages/ContactPage"));
const UnsubscribePage = lazyWithRetry(() => import("@/pages/UnsubscribePage"));
const UserProfilePage = lazyWithRetry(() => import("@/pages/UserProfilePage"));
const PredictPage = lazyWithRetry(() => import("@/pages/PredictPage"));
const VotePage = lazyWithRetry(() => import("@/pages/VotePage"));
const AllRatingsPage = lazyWithRetry(() => import("@/pages/AllRatingsPage"));
const MePage = lazyWithRetry(() => import("@/pages/MePage"));
const VotesPage = lazyWithRetry(() => import("@/pages/me/VotesPage"));
const PredictionsPage = lazyWithRetry(() => import("@/pages/me/PredictionsPage"));
const CommentsPage = lazyWithRetry(() => import("@/pages/me/CommentsPage"));
const FavoritesPage = lazyWithRetry(() => import("@/pages/me/FavoritesPage"));
const HiddenCardsPage = lazyWithRetry(() => import("@/pages/me/HiddenCardsPage"));
const SettingsPage = lazyWithRetry(() => import("@/pages/me/SettingsPage"));
const BadgesPage = lazyWithRetry(() => import("@/pages/me/BadgesPage"));
const NotificationsArchivePage = lazyWithRetry(() => import("@/pages/me/NotificationsPage"));
const PublicProfilePage = lazyWithRetry(() => import("@/pages/PublicProfilePage"));
const AdminDashboard = lazyWithRetry(() => import("@/pages/AdminDashboard"));
const AdminSuggestionsPage = lazyWithRetry(() => import("@/pages/admin/AdminSuggestionsPage"));
const AdminAnnouncementsPage = lazyWithRetry(() => import("@/pages/admin/AdminAnnouncementsPage"));
const AdminNotificationsPage = lazyWithRetry(() => import("@/pages/admin/AdminNotificationsPage"));
const MarketDetailPage = lazyWithRetry(() => import("@/pages/MarketDetailPage"));
const PollDetailPage = lazyWithRetry(() => import("@/pages/PollDetailPage"));
const OpinionPollDetailPage = lazyWithRetry(() => import("@/pages/OpinionPollDetailPage"));
const MatchupDetailPage = lazyWithRetry(() => import("@/pages/MatchupDetailPage"));
const UserLeaderboardPage = lazyWithRetry(() => import("@/pages/UserLeaderboardPage"));
const TownSquarePage = lazyWithRetry(() => import("@/pages/TownSquarePage"));
const InductionQueuePage = lazyWithRetry(() => import("@/pages/InductionQueuePage"));
const CategoryRaceDetailPage = lazyWithRetry(() => import("@/pages/CategoryRaceDetailPage"));
const UpDownDetailPage = lazyWithRetry(() => import("@/pages/UpDownDetailPage"));
const H2HDetailPage = lazyWithRetry(() => import("@/pages/H2HDetailPage"));
const HowItWorksPage = lazyWithRetry(() => import("@/pages/HowItWorksPage"));
const InsightsPage = lazyWithRetry(() => import("@/pages/InsightsPage"));
const VoicesPage = lazyWithRetry(() => import("@/pages/VoicesPage"));
const CreditHistoryPage = lazyWithRetry(() => import("@/pages/CreditHistoryPage"));
const ShareBetRedirect = lazyWithRetry(
  () => import("@/pages/ShareBetRedirect"),
);
const NotFound = lazyWithRetry(() => import("@/pages/not-found"));

// Entry-bundle diet: these only render behind gates (interests picker) or on
// rare events (rank-up celebration), so their chunks load off the critical path.
const InterestsPicker = lazyWithRetry(() =>
  import("@/components/interests/InterestsPicker").then((m) => ({
    default: m.InterestsPicker,
  })),
);
const RankUpModal = lazyWithRetry(() =>
  import("@/components/RankUpModal").then((m) => ({
    default: m.RankUpModal,
  })),
);

function PageFallback() {
  const [location] = useLocation();
  const navKey = primaryNavKeyForPath(location);
  if (navKey === "rankings") {
    return (
      <div className="min-h-screen pb-20">
        <SiteHeader active="rankings" backButton="none" />
        <div className="container mx-auto max-w-7xl px-2 pt-4 sm:px-4">
          <LeaderboardRowSkeleton count={8} />
        </div>
      </div>
    );
  }
  if (navKey === "vote") {
    return (
      <div className="min-h-screen pb-20">
        <SiteHeader active="vote" logoVariant="vote" backButton="none" />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-4 w-64 rounded" />
          <Skeleton className="h-64 w-full max-w-md rounded-xl" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-4 w-64 rounded" />
      <Skeleton className="h-64 w-full max-w-md rounded-xl" />
    </div>
  );
}

/** Warm Top Predictors after the first screen has had a chance to paint. */
function WarmTopPredictors() {
  useEffect(() => {
    const run = () => {
      void import("@/pages/UserLeaderboardPage");
      void queryClient.prefetchQuery({
        queryKey: ["/api/leaderboard/users", "all", ""],
        staleTime: 30_000,
        queryFn: async () => {
          const headers = await getAuthHeaders();
          const res = await fetch("/api/leaderboard/users?period=all&page=0&limit=25", {
            credentials: "include",
            headers,
          });
          if (!res.ok) throw new Error("Failed to prefetch predictors");
          return res.json();
        },
      });
    };
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(run, { timeout: 2500 });
      return () => win.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(run, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

/** Vote hub at `/`. Old `/?…#leaderboard` shares land on Rankings. */
function VoteHomeRoute() {
  const target =
    typeof window === "undefined"
      ? null
      : legacyLeaderboardShareTarget(
          window.location.pathname,
          window.location.search,
          window.location.hash,
        );
  if (target) return <Redirect to={target} replace />;
  return <VotePage />;
}

/** `/leaderboard` keeps working as an alias of `/rankings`. */
function LeaderboardAliasRedirect() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  return <Redirect to={leaderboardAliasTarget(search, hash)} replace />;
}

/**
 * Full loads read the hash inside VoteHomeRoute. Client navigations that
 * only change the hash (pushState does not remount `/`) are caught here.
 */
function LegacyLeaderboardShareRedirect() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const go = () => {
      const target = legacyLeaderboardShareTarget(
        window.location.pathname,
        window.location.search,
        window.location.hash,
      );
      if (!target) return;
      setLocation(target, { replace: true });
    };
    go();
    const frame = window.requestAnimationFrame(go);
    window.addEventListener("hashchange", go);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", go);
    };
  }, [location, setLocation]);

  return null;
}

function Router() {
  return (
    <>
      <LegacyLeaderboardShareRedirect />
      <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={VoteHomeRoute} />
        <Route path="/rankings" component={HomePage} />
        <Route path="/rankings/" component={HomePage} />
        <Route path="/leaderboard" component={LeaderboardAliasRedirect} />
        <Route path="/leaderboard/" component={LeaderboardAliasRedirect} />
        <Route path="/person/:id" component={PersonDetailPage} />
        <Route path="/celebrity/:id" component={PersonDetailPage} />
        <Route path="/login/verify" component={VerifyPage} />
        <Route path="/login/welcome" component={WelcomePage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/account-deletion" component={AccountDeletionPage} />
        <Route path="/takedown" component={TakedownPage} />
        {/* Free-to-play launch: purchases are disabled, so the old
            commerce URLs redirect. Refund questions belong in Terms;
            pricing/checkout intent lands on the "Earn Vox" guide. */}
        <Route path="/refund-policy">
          <Redirect to="/terms" replace />
        </Route>
        <Route path="/pricing">
          <Redirect to="/how-it-works?tab=credits#earn-vox" replace />
        </Route>
        <Route path="/checkout/:packageId">
          <Redirect to="/how-it-works?tab=credits#earn-vox" replace />
        </Route>
        <Route path="/contact" component={ContactPage} />
        <Route path="/unsubscribe" component={UnsubscribePage} />
        <Route path="/profile" component={UserProfilePage} />
        <Route path="/predict" component={PredictPage} />
        <Route path="/voices" component={VoicesPage} />
        <Route path="/insights" component={InsightsPage} />
        <Route path="/explore" component={InsightsPage} />
        <Route path="/vote/all-ratings" component={AllRatingsPage} />
        <Route path="/vote/induction" component={InductionQueuePage} />
        <Route path="/vote" component={VotePage} />
        <Route path="/me" component={MePage} />
        <Route path="/me/votes" component={VotesPage} />
        <Route path="/me/predictions" component={PredictionsPage} />
        <Route path="/me/comments" component={CommentsPage} />
        <Route path="/me/credits" component={CreditHistoryPage} />
        <Route path="/me/favorites" component={FavoritesPage} />
        <Route path="/me/hidden" component={HiddenCardsPage} />
        <Route path="/me/badges" component={BadgesPage} />
        <Route path="/me/settings" component={SettingsPage} />
        <Route path="/me/notifications" component={NotificationsArchivePage} />
        <Route path="/u/:username" component={PublicProfilePage} />
        <Route path="/markets/:slug" component={MarketDetailPage} />
        <Route path="/polls/:slug" component={PollDetailPage} />
        <Route path="/vote/opinion-polls/:slug" component={OpinionPollDetailPage} />
        <Route path="/vote/matchups/:slug" component={MatchupDetailPage} />
        <Route path="/predictions/leaderboard" component={UserLeaderboardPage} />
        <Route path="/predict/race/:marketId" component={CategoryRaceDetailPage} />
        <Route path="/predict/updown/:marketId" component={UpDownDetailPage} />
        <Route path="/predict/h2h/:marketId" component={H2HDetailPage} />
        <Route path="/predict/activity" component={TownSquarePage} />
        <Route path="/admin/suggestions" component={AdminSuggestionsPage} />
        {/* Notifications hub (compose + history + per-user inspector). */}
        <Route path="/admin/notifications" component={AdminNotificationsPage} />
        {/* Legacy alias for the older "/admin/announcements" link — same
            page so existing bookmarks and audit-log entries still resolve. */}
        <Route path="/admin/announcements" component={AdminNotificationsPage} />
        <Route path="/admin/announcements/legacy" component={AdminAnnouncementsPage} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/how-it-works" component={HowItWorksPage} />
        {/* Sprint 3: per-bet share URL. Bots are intercepted at the
            Vercel edge and routed to the OG image endpoint; humans hit
            this page which redirects to the canonical market page. */}
        <Route path="/share/bet/:betId" component={ShareBetRedirect} />
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </>
  );
}

function XpCelebrationWatcher() {
  const { isLoggedIn, profile } = useAuth();
  const [location] = useLocation();
  const celebrationsEnabled =
    isLoggedIn && shouldShowCelebrationToasts(profile, location);
  useXpCelebration(isLoggedIn);
  // Daily streak check-in lives alongside the celebration watcher so
  // its toast/burst output flows through the same XpBurstProvider tree.
  // Defer until onboarding completes — avoids streak toast covering
  // signup credit notifications on /login/welcome.
  useDailyCheckin(celebrationsEnabled);
  return null;
}

/**
 * Mount the Supabase Realtime subscription that powers live in-app
 * notifications. Lives inside <AuthProvider /> so the hook can read
 * the current session, and inside <QueryClientProvider /> so it can
 * invalidate the notification queries on insert. Hook itself is a
 * no-op when logged out.
 */
function NotificationsRealtimeWatcher() {
  useNotificationsRealtime();
  return null;
}

/**
 * Listens for `voxdex:rank-up` events (dispatched by the realtime
 * notifications hook via lib/rank-up-events) and lazy-mounts the
 * celebration modal when one arrives. The listener itself is a few
 * lines in the entry bundle; the modal chunk (Dialog + confetti +
 * rank config) is only fetched when a promotion actually fires.
 */
function RankUpModalGate() {
  const [payload, setPayload] = useState<RankUpPayload | null>(null);

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<RankUpPayload>).detail;
      if (!detail) return;
      setPayload(detail);
    }
    window.addEventListener(RANK_UP_EVENT, onEvent);
    return () => window.removeEventListener(RANK_UP_EVENT, onEvent);
  }, []);

  if (!payload) return null;
  return (
    <Suspense fallback={null}>
      <RankUpModal payload={payload} onClose={() => setPayload(null)} />
    </Suspense>
  );
}

function AnalyticsWatcher() {
  const [location] = useLocation();

  useEffect(() => {
    initGoogleAnalytics();
    trackGooglePageView(location);
    // Session landing page only — deduped internally per tab session.
    trackPageLand(location);
  }, [location]);

  return null;
}

/**
 * Captures `?ref=` and `?sharer=` from the inbound URL on mount.
 *
 * - Referral capture is fire-and-forget at the App level so a user
 *   landing on ANY route gets the code stashed before they sign up.
 * - Share-click capture waits for AuthContext to settle so the
 *   self-share guard can read the current user id; it re-runs when
 *   the user id changes (the rare anonymous → authenticated case
 *   inside the same session).
 */
function ShareAttributionWatcher() {
  const { user, loading } = useAuth();

  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  useEffect(() => {
    if (loading) return;
    void captureShareClickFromUrl(user?.id ?? null);
  }, [loading, user?.id]);

  return null;
}

/**
 * Warm HTTPS App Links. Cold start is applied in main.tsx before this
 * tree renders, so referral capture on mount still sees `?ref=` / `?sharer=`.
 * A link opened while the process is alive is pushed through wouter.
 */
function NativeContentLinkBridge() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  const sessionRef = useRef({ id: user?.id ?? null, loading });
  sessionRef.current = { id: user?.id ?? null, loading };

  useEffect(() => {
    return registerNativeContentNavigator((path, mode) => {
      setLocation(path, mode === "replace" ? { replace: true } : undefined);
      captureReferralFromUrl();
      if (!sessionRef.current.loading) {
        void captureShareClickFromUrl(sessionRef.current.id);
      }
      if (window.location.hash) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });
  }, [setLocation]);

  return null;
}

/**
 * Force first-time users through the multi-step /login/welcome flow before
 * they can land anywhere else. Catches the Google-OAuth signup path, which
 * skips the email verify screen entirely and would otherwise drop the user
 * straight on the home page without a username choice / ToS acceptance.
 *
 * Gate keys on `onboardingCompletedAt` (migration 0063) — the canonical
 * "user finished the whole flow" signal. `tosAcceptedAt` is now internal
 * to step 0 of the flow; a user who only got past ToS but bailed on the
 * later steps still has `onboardingCompletedAt = null` and gets sent
 * back into the flow to resume where they left off.
 *
 * Excludes /login/* (so the email signup flow can stay in place) and the
 * legal reference pages — opening Terms, Privacy, Account deletion,
 * Takedown, or Contact mid-onboarding shouldn't force-redirect the user
 * back to welcome before they finish reading.
 */
const NEW_USER_GATE_ALLOWLIST = new Set<string>(NEW_USER_GATE_ALLOWLIST_PATHS);

function NewUserGate() {
  const { user, profile, profileLoading, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading || profileLoading) return;
    if (!user || !profile) return;
    if (profile.onboardingCompletedAt) return;
    if (location.startsWith("/login")) return;
    if (NEW_USER_GATE_ALLOWLIST.has(location)) return;
    setLocation("/login/welcome", { replace: true });
  }, [loading, profileLoading, user, profile, location, setLocation]);

  return null;
}

/**
 * Interest Picker — first prompt and the "Want better recommendations?"
 * re-prompt.
 *
 * Opens on a personalised-feed surface (/, /vote, /predict) when terms are
 * accepted and `shouldOpenInterestsPrompt` says so:
 *
 *   * First-time: statedInterests empty, never dismissed. Opens immediately.
 *   * Re-prompt: still empty, and the last dismiss is at least REPROMPT_DAYS
 *     (2) old. Lifetime vote and prediction totals do not shorten that snooze.
 *     Saving interests stops the prompt for good.
 *
 * `repromptShownThisSession` stops a second open in the same document before
 * the refreshed profile lands. A full load asks again only after the snooze.
 */
const INTERESTS_GATE_ROUTES = new Set(["/", "/vote", "/predict"]);

function InterestsGate() {
  const { user, profile, profileLoading, loading } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  // Lazy-mount latch: the picker chunk only downloads once the modal has
  // actually been asked to open; it stays mounted afterwards so the close
  // animation still plays.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);
  // Once-per-session re-prompt latch: prevents the modal from popping back up
  // immediately after the user closes it via Save / Skip in the same tab.
  const repromptShownThisSession = useRef(false);

  // Hide-card hint stays down while this drawer is open, and for about a
  // minute after it closes. "Want better recommendations?" does not block
  // the hint for the rest of the page.
  useEffect(() => {
    setHideHintRecommendations({ open: open && hasOpened });
  }, [open, hasOpened]);

  useEffect(() => {
    if (loading || profileLoading) return;
    if (!user || !profile) return;
    if (!profile.tosAcceptedAt) return;
    if (!INTERESTS_GATE_ROUTES.has(location)) return;

    const dismissedAtMs = profile.interestsPromptDismissedAt
      ? new Date(profile.interestsPromptDismissedAt).getTime()
      : null;
    const openPrompt = shouldOpenInterestsPrompt({
      statedInterests: profile.statedInterests ?? [],
      dismissedAtMs,
      now: Date.now(),
      shownThisSession: repromptShownThisSession.current,
      totalVotes: profile.totalVotes ?? 0,
      totalPredictions: profile.totalPredictions ?? 0,
    });
    if (!openPrompt) return;
    // Re-prompt only. The first-time prompt has no dismiss timestamp, so a
    // failed skip can still ask again on the next feed route.
    if (dismissedAtMs !== null) {
      repromptShownThisSession.current = true;
    }
    setOpen(true);
  }, [loading, profileLoading, user, profile, location]);

  if (!user || !profile || !profile.tosAcceptedAt) return null;
  if (!hasOpened) return null;

  // Mode flips between onboarding (never dismissed) and reprompt (skipper).
  const mode: "onboarding" | "reprompt" = profile.interestsPromptDismissedAt
    ? "reprompt"
    : "onboarding";

  return (
    <Suspense fallback={null}>
      <InterestsPicker
        mode={mode}
        open={open}
        onOpenChange={setOpen}
        defaultValue={profile.statedInterests ?? []}
      />
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              {/* ReferralModalProvider owns a single referral modal so the
                  engagement gate, out-of-Vox prediction banners, and user
                  menu all open the same instance via `useReferralModal()`. */}
              <ReferralModalProvider>
                <ScrollToTop />
                {/* Timing, placement, and dedupe live in ThemedToaster + app-toast. */}
                <ThemedToaster />
                <PWAUpdatePrompt />
                <NewUserGate />
                <InterestsGate />
                <ReferralPromptGate />
                <NotificationsRealtimeWatcher />
                <StickyChromeFocusGuard />
                <RankUpModalGate />
                <AnalyticsWatcher />
                <ShareAttributionWatcher />
                <NativeContentLinkBridge />
                <XpBurstProvider>
                  {/* Watcher is inside XpBurstProvider so useXpCelebration can fire daily-login bursts via useXpBurst. */}
                  <XpCelebrationWatcher />
                  {/* ShareCard modal is mounted once at app root so every
                      surface (post-trade toast, open positions, settled
                      wins, leaderboard) opens the same instance via
                      `useShareCard()`. */}
                  <ShareCardProvider>
                    <SiteBanner />
                    <OfflineBanner />
                    <AnonFirstVoteNudge />
                    <WarmTopPredictors />
                    <div className="min-h-0 pt-[calc(var(--site-banner-height,0px)+var(--offline-banner-height,0px))]">
                      <ErrorBoundary>
                        <Router />
                      </ErrorBoundary>
                    </div>
                  </ShareCardProvider>
                </XpBurstProvider>
                <Footer />
                <BottomNav />
                <HelpChat />
              </ReferralModalProvider>
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
