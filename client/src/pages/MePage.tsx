import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/UserMenu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, User, Star, TrendingUp, Settings, LogOut, Vote, Wallet, Shield, Trophy, Sparkles, Eye, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";

function RankBadge({ rank }: { rank: string }) {
  const badgeConfig: Record<string, { color: string; icon: typeof Shield }> = {
    "Citizen": { color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Shield },
    "Engaged": { color: "bg-green-500/20 text-green-300 border-green-500/30", icon: Shield },
    "Contributor": { color: "bg-teal-500/20 text-teal-300 border-teal-500/30", icon: Sparkles },
    "Influencer": { color: "bg-purple-500/20 text-purple-300 border-purple-500/30", icon: Sparkles },
    "Trendsetter": { color: "bg-pink-500/20 text-pink-300 border-pink-500/30", icon: Sparkles },
    "Fame Maker": { color: "bg-orange-500/20 text-orange-300 border-orange-500/30", icon: Trophy },
    "Hall of Famer": { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: Trophy },
  };

  const config = badgeConfig[rank] || badgeConfig["Citizen"];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`${config.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {rank}
    </Badge>
  );
}

export default function MePage() {
  const { user, profile, profileLoading, isAdmin, signOut } = useAuth();
  const [, setLocation] = useLocation();

  const displayName = profile?.fullName || profile?.username || user?.email?.split("@")[0] || "User";
  const xpLevel = Math.floor((profile?.xpPoints || 0) / 500) + 1;

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
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <AuthoriDexLogo size={32} />
              <span className="font-serif font-bold text-xl">AuthoriDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/#leaderboard")} data-testid="nav-leaderboard-desktop">
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setLocation("/vote");
                window.scrollTo(0, 0);
              }} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
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
              <div className="flex items-start gap-4 mb-6">
                <Avatar className="h-16 w-16">
                  {profile?.avatarUrl ? (
                    <AvatarImage src={profile.avatarUrl} alt={displayName} />
                  ) : (
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold text-xl">
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-lg truncate">{displayName}</p>
                    {isAdmin && (
                      <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30">
                        Admin
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">@{profile?.username || "user"}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <RankBadge rank={profile?.rank || "Citizen"} />
                    <Badge variant="secondary" className="font-mono">
                      Level {xpLevel}
                    </Badge>
                    <Badge variant="outline" className="text-amber-400">
                      {(profile?.xpPoints || 0).toLocaleString('en-US')} XP
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-6 text-center">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-cyan-400">{profile?.totalVotes || 0}</p>
                  <p className="text-xs text-muted-foreground">Votes Cast</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-violet-400">{profile?.totalPredictions || 0}</p>
                  <p className="text-xs text-muted-foreground">Predictions</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-green-400">{profile?.winRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
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
                <h3 className="font-semibold">Predict Credits</h3>
                <Badge variant="outline" className="border-violet-500/30 text-violet-400">VIRTUAL</Badge>
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg bg-violet-500/10 border border-violet-500/30">
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-violet-400" />
                  <span className="text-muted-foreground">Balance</span>
                </div>
                <span className="font-mono font-bold text-2xl text-violet-400">
                  {(profile?.predictCredits || 0).toLocaleString('en-US')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Virtual credits for testing prediction features. No real money is involved.
              </p>
            </Card>

            {isAdmin && (
              <Card className="p-6 border-red-500/30 bg-red-500/5">
                <h3 className="font-semibold mb-4 text-red-400">Admin Panel</h3>
                <div className="space-y-3">
                  <Button 
                    variant="outline" 
                    className="w-full justify-start gap-3 border-red-500/30 hover:bg-red-500/10"
                    onClick={() => setLocation("/admin")}
                    data-testid="button-admin-panel"
                  >
                    <Shield className="h-4 w-4 text-red-400" />
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
