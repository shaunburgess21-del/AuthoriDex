import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/SiteHeader";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { User, Star, TrendingUp, Settings, LogOut, Vote, Wallet, Shield, Trophy, Eye, Lock, Flame, Award, MessageSquare } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { UserRankBadge } from "@/components/UserRankBadge";
import { ReferAFriendCard } from "@/components/ReferAFriendCard";
import { ProfileCompletionCard } from "@/components/ProfileCompletionCard";
import { REFERRAL_PANEL_GLOW_CLASS } from "@/components/referral/ReferralFriendPanel";
import { formatVox } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { getRankByName } from "@shared/rank-config";
import {
  getProfileTheme,
  PROFILE_BANNER_MIN_TIER,
  PROFILE_THEME_MIN_TIER,
} from "@shared/profile-theme-config";

export default function MePage() {
  const { user, profile, profileLoading, isAdmin, signOut, refreshProfile } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) void refreshProfile();
  }, [user, refreshProfile]);

  const displayName = profile?.username || user?.email?.split("@")[0] || "User";

  // Per-tier profile visual unlocks (Phase 5). /api/profile/me returns the
  // raw stored values (not tier-gated like the public endpoint), so gate on
  // the owner's CURRENT rank tier here — a demotion hides, never deletes.
  const ownerTier = getRankByName(profile?.rank ?? "")?.tier ?? 1;
  const banner =
    ownerTier >= PROFILE_BANNER_MIN_TIER ? profile?.profileBannerUrl ?? null : null;
  const theme =
    ownerTier >= PROFILE_THEME_MIN_TIER ? getProfileTheme(profile?.profileTheme) : null;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <SiteHeader />

      <div className="container mx-auto px-2 sm:px-4 py-8 max-w-[964px]">
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
            <Card
              className="overflow-hidden p-6"
              style={
                theme
                  ? {
                      backgroundImage: `linear-gradient(180deg, ${theme.gradient[0]}26, transparent 55%)`,
                      borderColor: `${theme.accent}55`,
                    }
                  : undefined
              }
            >
              {banner && (
                <div className="-mx-6 -mt-6 mb-6 h-28 overflow-hidden bg-muted sm:h-32">
                  <img src={banner} alt="" className="h-full w-full object-cover" />
                </div>
              )}
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
                    <UserRankBadge rank={profile?.rank || "Citizen"} />
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400 px-3 py-1">
                      {(profile?.xpPoints || 0).toLocaleString('en-US')} XP
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6 text-center">
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/votes")}
                  data-testid="link-me-votes-stat"
                >
                  <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{profile?.totalVotes || 0}</p>
                  <p className="text-xs text-muted-foreground">Votes Cast</p>
                </button>
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/predictions?tab=predictions")}
                  data-testid="link-me-predictions-stat"
                >
                  <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{profile?.totalPredictions || 0}</p>
                  <p className="text-xs text-muted-foreground">Predictions</p>
                </button>
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/predictions")}
                  data-testid="link-me-win-rate-stat"
                >
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{profile?.winRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </button>
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/credits")}
                  data-testid="link-me-credits-stat"
                >
                  <div className="flex items-center justify-center gap-1">
                    <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <p className="text-2xl font-bold text-violet-600 dark:text-violet-400 font-mono">{formatVox(profile?.predictCredits || 0)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Vox</p>
                </button>
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/how-it-works#streak")}
                  data-testid="link-me-streak-stat"
                >
                  <div className="flex items-center justify-center gap-1">
                    <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{profile?.currentStreak || 0}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Streak</p>
                </button>
                <button
                  type="button"
                  className="p-3 sm:p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/comments")}
                  data-testid="link-me-comments-stat"
                >
                  <div className="flex items-center justify-center gap-1">
                    <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{profile?.totalComments || 0}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Comments</p>
                </button>
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
                  onClick={() => setLocation("/me/comments")}
                  data-testid="button-my-comments"
                >
                  <MessageSquare className="h-4 w-4" />
                  My Comments
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/credits")}
                  data-testid="button-my-credits"
                >
                  <Wallet className="h-4 w-4" />
                  My Vox
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-3"
                  onClick={() => setLocation("/me/badges")}
                  data-testid="button-my-badges"
                >
                  <Award className="h-4 w-4" />
                  My Badges
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

            <Card className={cn(REFERRAL_PANEL_GLOW_CLASS, "p-6")}>
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
                <button
                  type="button"
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-violet-500/40 dark:border-violet-500/30 overflow-hidden w-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setLocation("/me/credits")}
                  data-testid="link-me-credits-balance"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Wallet className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    <span className="text-sm text-muted-foreground truncate">Balance</span>
                  </div>
                  <span
                    className="font-mono font-bold text-lg tabular-nums min-w-0 truncate text-violet-600 dark:text-violet-400"
                    title={formatVox(profile?.predictCredits || 0)}
                  >
                    {formatVox(profile?.predictCredits || 0)}
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-orange-500/40 dark:border-orange-500/30 overflow-hidden">
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
              {/* Earn CTA lives on the Predictor Stats card (rather than
                  inside the dense 5-stat grid above) so there's room for a
                  proper button that doesn't squeeze the Vox number on
                  mobile. /how-it-works is public, so logged-out viewers of this
                  card never reach this surface anyway. */}
              <Button
                className="w-full mt-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                onClick={() => setLocation("/how-it-works?tab=credits#earn-vox")}
                data-testid="button-earn-credits-me"
              >
                <Wallet className="h-4 w-4 mr-2" />
                Earn Vox
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Vox powers your predictions. It never expires and has no cash value.
              </p>
            </Card>

            <ReferAFriendCard />

            <ProfileCompletionCard />

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
