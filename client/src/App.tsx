import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { BottomNav } from "@/components/BottomNav";
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
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/person/:id" component={PersonDetailPage} />
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
      <Route path="/admin" component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
          <BottomNav />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
