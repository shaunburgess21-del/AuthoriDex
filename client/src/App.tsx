import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomNav } from "@/components/BottomNav";
import { ScrollToTop } from "@/components/ScrollToTop";
import HomePage from "@/pages/HomePage";
import PersonDetailPage from "@/pages/PersonDetailPage";
import LoginPage from "@/pages/LoginPage";
import UserProfilePage from "@/pages/UserProfilePage";
import PredictPage from "@/pages/PredictPage";
import VotePage from "@/pages/VotePage";
import MePage from "@/pages/MePage";
import VotesPage from "@/pages/me/VotesPage";
import PredictionsPage from "@/pages/me/PredictionsPage";
import FavoritesPage from "@/pages/me/FavoritesPage";
import SettingsPage from "@/pages/me/SettingsPage";
import PublicProfilePage from "@/pages/PublicProfilePage";
import AdminDashboard from "@/pages/AdminDashboard";
import MarketDetailPage from "@/pages/MarketDetailPage";
import PollDetailPage from "@/pages/PollDetailPage";
import OpinionPollDetailPage from "@/pages/OpinionPollDetailPage";
import MatchupDetailPage from "@/pages/MatchupDetailPage";
import UserLeaderboardPage from "@/pages/UserLeaderboardPage";
import NotFound from "@/pages/not-found";

function Router() {
  return (
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
