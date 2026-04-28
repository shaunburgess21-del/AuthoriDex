import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Switch, Route, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { ScrollToTop } from "@/components/ScrollToTop";
import { XpBurstProvider } from "@/components/XpBurstProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { useXpCelebration } from "@/hooks/useGamification";

// If we got here the page loaded successfully -- clear any leftover retry
// flag from a previous stale-chunk reload so the mechanism works on the
// next deploy too.
sessionStorage.removeItem("chunk_retry");

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
const UserProfilePage = lazyWithRetry(() => import("@/pages/UserProfilePage"));
const PredictPage = lazyWithRetry(() => import("@/pages/PredictPage"));
const VotePage = lazyWithRetry(() => import("@/pages/VotePage"));
const ValueRankingsPage = lazyWithRetry(() => import("@/pages/ValueRankingsPage"));
const MePage = lazyWithRetry(() => import("@/pages/MePage"));
const VotesPage = lazyWithRetry(() => import("@/pages/me/VotesPage"));
const PredictionsPage = lazyWithRetry(() => import("@/pages/me/PredictionsPage"));
const FavoritesPage = lazyWithRetry(() => import("@/pages/me/FavoritesPage"));
const SettingsPage = lazyWithRetry(() => import("@/pages/me/SettingsPage"));
const PublicProfilePage = lazyWithRetry(() => import("@/pages/PublicProfilePage"));
const AdminDashboard = lazyWithRetry(() => import("@/pages/AdminDashboard"));
const AdminSuggestionsPage = lazyWithRetry(() => import("@/pages/admin/AdminSuggestionsPage"));
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
        <Route path="/profile" component={UserProfilePage} />
        <Route path="/predict" component={PredictPage} />
        <Route path="/vote/value-rankings" component={ValueRankingsPage} />
        <Route path="/vote/induction" component={InductionQueuePage} />
        <Route path="/vote" component={VotePage} />
        <Route path="/me" component={MePage} />
        <Route path="/me/votes" component={VotesPage} />
        <Route path="/me/predictions" component={PredictionsPage} />
        <Route path="/me/favorites" component={FavoritesPage} />
        <Route path="/me/settings" component={SettingsPage} />
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
        <Route path="/admin" component={AdminDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function XpCelebrationWatcher() {
  const { isLoggedIn } = useAuth();
  useXpCelebration(isLoggedIn);
  return null;
}

/**
 * Force first-time users (no `tosAcceptedAt`) through /login/welcome before
 * they can land anywhere else. Catches the Google-OAuth signup path, which
 * skips the email verify screen entirely and would otherwise drop the user
 * straight on the home page without a username choice / ToS acceptance.
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
    if (profile.tosAcceptedAt) return;
    if (location.startsWith("/login")) return;
    if (NEW_USER_GATE_ALLOWLIST.has(location)) return;
    setLocation("/login/welcome", { replace: true });
  }, [loading, profileLoading, user, profile, location, setLocation]);

  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <ScrollToTop />
              {/* duration: Sonner default 4000ms felt too brief on slow
                  reads, 6000ms felt slightly stuck, 5000ms is the sweet
                  spot per real-device QA. closeButton lets impatient
                  users dismiss early. */}
              <Toaster richColors closeButton position="top-center" duration={5000} />
              <PWAUpdatePrompt />
              <NewUserGate />
              <XpBurstProvider>
                {/* Watcher is inside XpBurstProvider so useXpCelebration can fire daily-login bursts via useXpBurst. */}
                <XpCelebrationWatcher />
                <ErrorBoundary>
                  <Router />
                </ErrorBoundary>
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
