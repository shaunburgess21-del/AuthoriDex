import { lazy, Suspense, type ComponentType } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomNav } from "@/components/BottomNav";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Skeleton } from "@/components/ui/skeleton";

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
const UserProfilePage = lazyWithRetry(() => import("@/pages/UserProfilePage"));
const PredictPage = lazyWithRetry(() => import("@/pages/PredictPage"));
const VotePage = lazyWithRetry(() => import("@/pages/VotePage"));
const MePage = lazyWithRetry(() => import("@/pages/MePage"));
const VotesPage = lazyWithRetry(() => import("@/pages/me/VotesPage"));
const PredictionsPage = lazyWithRetry(() => import("@/pages/me/PredictionsPage"));
const FavoritesPage = lazyWithRetry(() => import("@/pages/me/FavoritesPage"));
const SettingsPage = lazyWithRetry(() => import("@/pages/me/SettingsPage"));
const PublicProfilePage = lazyWithRetry(() => import("@/pages/PublicProfilePage"));
const AdminDashboard = lazyWithRetry(() => import("@/pages/AdminDashboard"));
const MarketDetailPage = lazyWithRetry(() => import("@/pages/MarketDetailPage"));
const PollDetailPage = lazyWithRetry(() => import("@/pages/PollDetailPage"));
const OpinionPollDetailPage = lazyWithRetry(() => import("@/pages/OpinionPollDetailPage"));
const MatchupDetailPage = lazyWithRetry(() => import("@/pages/MatchupDetailPage"));
const UserLeaderboardPage = lazyWithRetry(() => import("@/pages/UserLeaderboardPage"));
const TownSquarePage = lazyWithRetry(() => import("@/pages/TownSquarePage"));
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
        <Route path="/login" component={LoginPage} />
        <Route path="/profile" component={UserProfilePage} />
        <Route path="/predict" component={PredictPage} />
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
        <Route path="/predict/activity" component={TownSquarePage} />
        <Route path="/admin" component={AdminDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <ScrollToTop />
            <Toaster />
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
            <BottomNav />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
