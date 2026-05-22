import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Switch, Route, useLocation } from "wouter";
import { InterestsPicker } from "@/components/interests/InterestsPicker";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemedToaster } from "@/components/ThemedToaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { ScrollToTop } from "@/components/ScrollToTop";
import { XpBurstProvider } from "@/components/XpBurstProvider";
import { ShareCardProvider } from "@/contexts/ShareCardContext";
import { RankUpModalHost } from "@/components/RankUpModal";
import { Skeleton } from "@/components/ui/skeleton";
import { useDailyCheckin, useXpCelebration } from "@/hooks/useGamification";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { initGoogleAnalytics, trackGooglePageView } from "@/lib/analytics";
import {
  captureReferralFromUrl,
  captureShareClickFromUrl,
} from "@/lib/referral-capture";

// If we got here the page loaded successfully -- clear any leftover retry
// flag from a previous stale-chunk reload so the mechanism works on the
// next deploy too.
sessionStorage.removeItem("chunk_retry");

if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

/**
 * Wraps React.lazy with automatic recovery from stale-chunk errors.
 * After a deploy the old HTML may reference chunk filenames that no longer
 * exist. When the dynamic import fails we do a single full-page reload so
 * the browser fetches the new HTML with correct chunk URLs.
 */
function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const alreadyRetried = sessionStorage.getItem("chunk_retry");
      if (!alreadyRetried) {
        sessionStorage.setItem("chunk_retry", "1");
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      sessionStorage.removeItem("chunk_retry");
      throw err;
    })
  );
}

const HomePage = lazyWithRetry(() => import("@/pages/HomePage"));
const PersonDetailPage = lazyWithRetry(() => import("@/pages/PersonDetailPage"));
const LoginPage = lazyWithRetry(() => import("@/pages/LoginPage"));
const VerifyPage = lazyWithRetry(() => import("@/pages/auth/VerifyPage"));
const WelcomePage = lazyWithRetry(() => import("@/pages/auth/WelcomePage"));
const TermsPage = lazyWithRetry(() => import("@/pages/TermsPage"));
const PrivacyPage = lazyWithRetry(() => import("@/pages/PrivacyPage"));
const TakedownPage = lazyWithRetry(() => import("@/pages/TakedownPage"));
const RefundPolicyPage = lazyWithRetry(() => import("@/pages/RefundPolicyPage"));
const PricingPage = lazyWithRetry(() => import("@/pages/PricingPage"));
const CheckoutPage = lazyWithRetry(() => import("@/pages/CheckoutPage"));
const ContactPage = lazyWithRetry(() => import("@/pages/ContactPage"));
const UnsubscribePage = lazyWithRetry(() => import("@/pages/UnsubscribePage"));
const UserProfilePage = lazyWithRetry(() => import("@/pages/UserProfilePage"));
const PredictPage = lazyWithRetry(() => import("@/pages/PredictPage"));
const VotePage = lazyWithRetry(() => import("@/pages/VotePage"));
const ValueRankingsPage = lazyWithRetry(() => import("@/pages/ValueRankingsPage"));
const MePage = lazyWithRetry(() => import("@/pages/MePage"));
const VotesPage = lazyWithRetry(() => import("@/pages/me/VotesPage"));
const PredictionsPage = lazyWithRetry(() => import("@/pages/me/PredictionsPage"));
const FavoritesPage = lazyWithRetry(() => import("@/pages/me/FavoritesPage"));
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
const ValueRatingsPage = lazyWithRetry(() => import("@/pages/ValueRatingsPage"));
const InductionQueuePage = lazyWithRetry(() => import("@/pages/InductionQueuePage"));
const CategoryRaceDetailPage = lazyWithRetry(() => import("@/pages/CategoryRaceDetailPage"));
const UpDownDetailPage = lazyWithRetry(() => import("@/pages/UpDownDetailPage"));
const H2HDetailPage = lazyWithRetry(() => import("@/pages/H2HDetailPage"));
const HowItWorksPage = lazyWithRetry(() => import("@/pages/HowItWorksPage"));
const CreditHistoryPage = lazyWithRetry(() => import("@/pages/CreditHistoryPage"));
const ShareBetRedirect = lazyWithRetry(
  () => import("@/pages/ShareBetRedirect"),
);
const NotFound = lazyWithRetry(() => import("@/pages/not-found"));

function PageFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-4 w-64 rounded" />
      <Skeleton className="h-64 w-full max-w-md rounded-xl" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/person/:id" component={PersonDetailPage} />
        <Route path="/celebrity/:id" component={PersonDetailPage} />
        <Route path="/login/verify" component={VerifyPage} />
        <Route path="/login/welcome" component={WelcomePage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/takedown" component={TakedownPage} />
        <Route path="/refund-policy" component={RefundPolicyPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/checkout/:packageId" component={CheckoutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/unsubscribe" component={UnsubscribePage} />
        <Route path="/profile" component={UserProfilePage} />
        <Route path="/predict" component={PredictPage} />
        <Route path="/vote/value-rankings" component={ValueRankingsPage} />
        <Route path="/vote/induction" component={InductionQueuePage} />
        <Route path="/vote" component={VotePage} />
        <Route path="/me" component={MePage} />
        <Route path="/me/votes" component={VotesPage} />
        <Route path="/me/predictions" component={PredictionsPage} />
        <Route path="/me/credits" component={CreditHistoryPage} />
        <Route path="/me/favorites" component={FavoritesPage} />
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
        <Route path="/vote/value-ratings" component={ValueRatingsPage} />
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
  );
}

function XpCelebrationWatcher() {
  const { isLoggedIn } = useAuth();
  useXpCelebration(isLoggedIn);
  // Daily streak check-in lives alongside the celebration watcher so
  // its toast/burst output flows through the same XpBurstProvider tree.
  useDailyCheckin(isLoggedIn);
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

function AnalyticsWatcher() {
  const [location] = useLocation();

  useEffect(() => {
    initGoogleAnalytics();
    trackGooglePageView(location);
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
 * legal / pricing reference pages — opening Terms, Privacy, Takedown,
 * Refund Policy, or Pricing mid-onboarding shouldn't force-redirect the
 * user back to welcome before they finish reading.
 */
const NEW_USER_GATE_ALLOWLIST = new Set([
  "/terms",
  "/privacy",
  "/takedown",
  "/refund-policy",
  "/pricing",
  "/contact",
]);

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
 * Interest Picker — Phase 1 prompt + soft re-prompt gate.
 *
 * Shows the InterestsPicker modal exactly when the user is on a
 * personalised-feed surface (/, /vote, /predict) AND we have a clear reason
 * to ask:
 *
 *   * First-time prompt:
 *       tosAcceptedAt set, statedInterests empty, never dismissed.
 *
 *   * Soft re-prompt (skippers only — once per browser tab):
 *       tosAcceptedAt set, statedInterests still empty, dismissed AT LEAST
 *       once, AND any of:
 *         - >= 2 days have passed since dismissal, OR
 *         - totalVotes >= 20, OR
 *         - totalPredictions >= 20.
 *
 * The "once per session" check uses an in-memory ref so we don't nag a user
 * who chose "Not now" again in the same tab; refreshing the tab is fine —
 * if the dismissed clock has rolled over again or they crossed an
 * engagement threshold, we earn another nudge.
 */
const INTERESTS_GATE_ROUTES = new Set(["/", "/vote", "/predict"]);
const REPROMPT_DAYS = 2;
const REPROMPT_VOTE_THRESHOLD = 20;
const REPROMPT_PREDICT_THRESHOLD = 20;
const MS_PER_DAY = 86_400_000;

function InterestsGate() {
  const { user, profile, profileLoading, loading } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  // Once-per-session re-prompt latch: prevents the modal from popping back up
  // immediately after the user closes it via Save / Skip in the same tab.
  const repromptShownThisSession = useRef(false);

  useEffect(() => {
    if (loading || profileLoading) return;
    if (!user || !profile) return;
    if (!profile.tosAcceptedAt) return;
    if (!INTERESTS_GATE_ROUTES.has(location)) return;
    const interests = profile.statedInterests ?? [];
    if (interests.length > 0) return;

    const dismissedAt = profile.interestsPromptDismissedAt
      ? new Date(profile.interestsPromptDismissedAt).getTime()
      : null;

    // First-time path: never dismissed, never picked. Open immediately.
    if (dismissedAt === null) {
      setOpen(true);
      return;
    }

    if (repromptShownThisSession.current) return;

    const daysSince = (Date.now() - dismissedAt) / MS_PER_DAY;
    const meetsTime = daysSince >= REPROMPT_DAYS;
    const meetsVotes = (profile.totalVotes ?? 0) >= REPROMPT_VOTE_THRESHOLD;
    const meetsPredictions =
      (profile.totalPredictions ?? 0) >= REPROMPT_PREDICT_THRESHOLD;

    if (meetsTime || meetsVotes || meetsPredictions) {
      repromptShownThisSession.current = true;
      setOpen(true);
    }
  }, [loading, profileLoading, user, profile, location]);

  if (!user || !profile || !profile.tosAcceptedAt) return null;

  // Mode flips between onboarding (never dismissed) and reprompt (skipper).
  const mode: "onboarding" | "reprompt" = profile.interestsPromptDismissedAt
    ? "reprompt"
    : "onboarding";

  return (
    <InterestsPicker
      mode={mode}
      open={open}
      onOpenChange={setOpen}
      defaultValue={profile.statedInterests ?? []}
    />
  );
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <ScrollToTop />
              {/* duration: Sonner default 4000ms felt too brief on slow reads;
                  5000ms was comfortable but a touch long — 4000ms matches the
                  library default while staying readable. closeButton + swipe
                  (see swipeDirections) let users dismiss early on desktop/touch. */}
              <ThemedToaster />
              <PWAUpdatePrompt />
              <NewUserGate />
              <InterestsGate />
              <NotificationsRealtimeWatcher />
              <RankUpModalHost />
              <AnalyticsWatcher />
              <ShareAttributionWatcher />
              <XpBurstProvider>
                {/* Watcher is inside XpBurstProvider so useXpCelebration can fire daily-login bursts via useXpBurst. */}
                <XpCelebrationWatcher />
                {/* ShareCard modal is mounted once at app root so every
                    surface (post-trade toast, open positions, settled
                    wins, leaderboard) opens the same instance via
                    `useShareCard()`. */}
                <ShareCardProvider>
                  <ErrorBoundary>
                    <Router />
                  </ErrorBoundary>
                </ShareCardProvider>
              </XpBurstProvider>
              <Footer />
              <BottomNav />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
