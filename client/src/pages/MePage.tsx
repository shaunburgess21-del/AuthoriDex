import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { ArrowLeft, User, Star, TrendingUp, Settings, LogOut, Vote, Wallet, Shield, Trophy, Sparkles, Eye, Lock, Flame, CreditCard } from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { VoxDexLogo } from "@/components/VoxDexLogo";

function RankBadge({ rank }: { rank: string }) {
  const badgeConfig: Record<string, { color: string; icon: typeof Shield }> = {
    "Citizen": { color: "bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border-blue-500/40 dark:border-blue-500/30", icon: Shield },
    "Engaged": { color: "bg-green-500/25 dark:bg-green-500/20 text-green-500 dark:text-green-300 border-green-500/40 dark:border-green-500/30", icon: Shield },
    "Contributor": { color: "bg-teal-500/25 dark:bg-teal-500/20 text-teal-500 dark:text-teal-300 border-teal-500/40 dark:border-teal-500/30", icon: Sparkles },
    "Influencer": { color: "bg-purple-500/25 dark:bg-purple-500/20 text-purple-500 dark:text-purple-300 border-purple-500/40 dark:border-purple-500/30", icon: Sparkles },
    "Trendsetter": { color: "bg-pink-500/25 dark:bg-pink-500/20 text-pink-500 dark:text-pink-300 border-pink-500/40 dark:border-pink-500/30", icon: Sparkles },
    "Fame Maker": { color: "bg-orange-500/25 dark:bg-orange-500/20 text-orange-500 dark:text-orange-300 border-orange-500/40 dark:border-orange-500/30", icon: Trophy },
    "Hall of Famer": { color: "bg-amber-500/25 dark:bg-amber-500/20 text-amber-500 dark:text-amber-300 border-amber-500/40 dark:border-amber-500/30", icon: Trophy },
  };

  const config = badgeConfig[rank] || badgeConfig["Citizen"];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`${config.color} px-3 py-1 gap-1.5`}>
      <Icon className="h-3 w-3" />
      {rank}
    </Badge>
  );
}

export default function MePage() {
  const { user, profile, profileLoading, isAdmin, signOut } = useAuth();
  const [, setLocation] = useLocation();

  const displayName = profile?.username || user?.email?.split("@")[0] || "User";

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/");
                }
              }}
              className="md:hidden"
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <VoxDexLogo size={32} />
              <span className="font-serif font-bold text-xl">VoxDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/#leaderboard")} data-testid="nav-leaderboard-desktop">
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => {
                setLocation("/vote");
                window.scrollTo(0, 0);
              }} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <HeaderUserActions />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-8 max-w-2xl">
        <h1 className="text-3xl font-serif font-bold mb-6" data-testid="text-me-title">
          My Account
        </h1>

        {user ? (
          profileLoading && !profile ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Loading your account...</p>
            </Card>
          ) : (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-start gap-4 mb-6">
                <UserProfileAvatar
                  displayName={displayName}
                  avatarUrl={profile?.avatarUrl}
                  size="lg"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-lg truncate">{displayName}</p>
                    {isAdmin && (
                      <Badge variant="outline" className="bg-red-500/25 dark:bg-red-500/20 text-red-500 dark:text-red-300 border-red-500/40 dark:border-red-500/30 px-3 py-1">
                        Admin
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">@{profile?.username || "user"}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <RankBadge rank={profile?.rank || "Citizen"} />
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400 px-3 py-1">
                      {(profile?.xpPoints || 0).toLocaleString('en-US')} XP
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6 text-center">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{profile?.totalVotes || 0}</p>
                  <p className="text-xs text-muted-foreground">Votes Cast</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{profile?.totalPredictions || 0}</p>
                  <p className="text-xs text-muted-foreground">Predictions</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{profile?.winRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </div>
                <div className="p-3 rounded-lg bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/30 dark:border-violet-500/20">
                  <div className="flex items-center justify-center gap-1">
                    <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <p className="text-2xl font-bold text-violet-600 dark:text-violet-400 font-mono">{(profile?.predictCredits || 0).toLocaleString('en-US')}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Credits</p>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/15 dark:bg-orange-500/10 border border-orange-500/30 dark:border-orange-500/20">
                  <div className="flex items-center justify-center gap-1">
                    <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{profile?.currentStreak || 0}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Streak</p>
                </div>
              </div>
              
              <div className="space-y-3">
                {profile?.username && (
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-3"
                    onClick={() => setLocation(`/u/${profile.username}`)}
                    data-testid="button-view-public-profile"
                  >
                    {profile.isPublic ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    View Public Profile
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {profile.isPublic ? "Public" : "Private"}
                    </Badge>
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/votes")}
                  data-testid="button-my-votes"
                >
                  <Vote className="h-4 w-4" />
                  My Votes
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/predictions")}
                  data-testid="button-my-predictions"
                >
                  <TrendingUp className="h-4 w-4" />
                  My Predictions
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/favorites")}
                  data-testid="button-my-favorites"
                >
                  <Star className="h-4 w-4" />
                  My Favorites
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/settings")}
                  data-testid="button-settings"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Predictor Stats</h3>
                <Badge variant="outline" className="px-3 border-violet-500/40 dark:border-violet-500/30 text-violet-600 dark:text-violet-400">VIRTUAL</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Label is `flex-1` so it absorbs free space and
                    ellipsifies first; value is `min-w-0 truncate` so a
                    long number (e.g. "1,234,567") falls back to an
                    ellipsis with a hover tooltip instead of being
                    silently clipped at the pill edge. */}
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30 overflow-hidden">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Wallet className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    <span className="text-sm text-muted-foreground truncate">Balance</span>
                  </div>
                  <span
                    className="font-mono font-bold text-lg tabular-nums min-w-0 truncate text-violet-600 dark:text-violet-400"
                    title={(profile?.predictCredits || 0).toLocaleString('en-US')}
                  >
                    {(profile?.predictCredits || 0).toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-orange-500/15 dark:bg-orange-500/10 border border-orange-500/40 dark:border-orange-500/30 overflow-hidden">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Flame className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm text-muted-foreground truncate">Streak</span>
                  </div>
                  <span
                    className="font-mono font-bold text-lg tabular-nums min-w-0 truncate text-orange-600 dark:text-orange-400"
                    title={String(profile?.currentStreak || 0)}
                  >
                    {profile?.currentStreak || 0}
                  </span>
                </div>
              </div>
              {/* Top-up CTA lives on the Predictor Stats card (rather than
                  inside the dense 5-stat grid above) so there's room for a
                  proper button that doesn't squeeze the credit number on
                  mobile. /pricing is public, so logged-out viewers of this
                  card never reach this surface anyway. */}
              <Button
                className="w-full mt-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                onClick={() => setLocation("/pricing")}
                data-testid="button-buy-credits-me"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Buy Credits
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Credits power your predictions. They never expire and have no cash value.
              </p>
            </Card>

            {isAdmin && (
              <Card className="p-6 border-red-500/40 dark:border-red-500/30 bg-red-500/8 dark:bg-red-500/5">
                <h3 className="font-semibold mb-4 text-red-600 dark:text-red-400">Admin Panel</h3>
                <div className="space-y-3">
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-3 border-red-500/40 dark:border-red-500/30 hover:bg-red-500/15 dark:hover:bg-red-500/10"
                    onClick={() => setLocation("/admin")}
                    data-testid="button-admin-panel"
                  >
                    <Shield className="h-4 w-4 text-red-600 dark:text-red-400" />
                    Manage Site
                  </Button>
                </div>
              </Card>
            )}

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
          )
        ) : (
          <Card className="p-8 text-center">
            <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Sign in to access your account</h2>
            <p className="text-muted-foreground mb-6">
              Track your favorites, view predictions, and manage your profile.
            </p>
            <Button onClick={() => navigateToLogin(setLocation)} data-testid="button-sign-in">
              Sign In
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
