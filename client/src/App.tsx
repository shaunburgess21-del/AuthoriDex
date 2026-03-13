import { lazy, Suspense } from "react";
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

const HomePage = lazy(() => import("@/pages/HomePage"));
const PersonDetailPage = lazy(() => import("@/pages/PersonDetailPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const UserProfilePage = lazy(() => import("@/pages/UserProfilePage"));
const PredictPage = lazy(() => import("@/pages/PredictPage"));
const VotePage = lazy(() => import("@/pages/VotePage"));
const MePage = lazy(() => import("@/pages/MePage"));
const VotesPage = lazy(() => import("@/pages/me/VotesPage"));
const PredictionsPage = lazy(() => import("@/pages/me/PredictionsPage"));
const FavoritesPage = lazy(() => import("@/pages/me/FavoritesPage"));
const SettingsPage = lazy(() => import("@/pages/me/SettingsPage"));
const PublicProfilePage = lazy(() => import("@/pages/PublicProfilePage"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const MarketDetailPage = lazy(() => import("@/pages/MarketDetailPage"));
const PollDetailPage = lazy(() => import("@/pages/PollDetailPage"));
const OpinionPollDetailPage = lazy(() => import("@/pages/OpinionPollDetailPage"));
const MatchupDetailPage = lazy(() => import("@/pages/MatchupDetailPage"));
const UserLeaderboardPage = lazy(() => import("@/pages/UserLeaderboardPage"));
const NotFound = lazy(() => import("@/pages/not-found"));

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
