import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserMenu } from "@/components/UserMenu";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowLeft, User, Star, TrendingUp, Settings, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export default function MePage() {
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              className="md:hidden"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="nav-home-desktop">
                Home
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/vote")} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
              <Button variant="ghost" size="sm" className="text-primary" data-testid="nav-me-desktop">
                Me
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-3xl font-serif font-bold mb-6" data-testid="text-me-title">
          My Account
        </h1>

        {user ? (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <UserAvatar />
                <div>
                  <p className="font-semibold text-lg">{user.email}</p>
                  <p className="text-sm text-muted-foreground">Member since {new Date().getFullYear()}</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/profile")}
                  data-testid="button-view-profile"
                >
                  <User className="h-4 w-4" />
                  View Profile
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  data-testid="button-my-favorites"
                >
                  <Star className="h-4 w-4" />
                  My Favorites
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  data-testid="button-my-predictions"
                >
                  <TrendingUp className="h-4 w-4" />
                  My Predictions
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  data-testid="button-settings"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Test Mode Credits</h3>
              <div className="flex items-center justify-between mb-4">
                <span className="text-muted-foreground">Virtual Balance</span>
                <span className="font-mono font-bold text-xl text-primary">1,000 TC</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Test Credits (TC) are virtual currency for testing prediction features. 
                No real money is involved.
              </p>
            </Card>

            <Button 
              variant="outline" 
              className="w-full gap-2 text-destructive hover:text-destructive"
              onClick={() => signOut()}
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        ) : (
          <Card className="p-8 text-center">
            <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Sign in to access your account</h2>
            <p className="text-muted-foreground mb-6">
              Track your favorites, view predictions, and manage your profile.
            </p>
            <Button onClick={() => setLocation("/login")} data-testid="button-sign-in">
              Sign In
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
