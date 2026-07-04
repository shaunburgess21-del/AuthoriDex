import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth, UserProfile } from "@/contexts/AuthContext";
import { useThemeToggle } from "@/hooks/useThemeToggle";
import { useRanks } from "@/hooks/useGamification";
import { UserRankBadge } from "@/components/UserRankBadge";
import { navigateToLogin } from "@/lib/authReturn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { 
  User,
  Menu,
  Trophy, 
  Vote, 
  Settings, 
  LogOut, 
  Sun, 
  Moon, 
  ChevronRight,
  TrendingUp,
  Zap,
  Wallet,
  LayoutDashboard,
  Flame,
  BookOpen,
  LineChart,
  Gift,
} from "lucide-react";
import { CURRENCY, voxWord } from "@/lib/currency";
import { CREDIT_ACTIONS } from "@shared/credit-config";
import { useReferralModal } from "@/components/referral/ReferralModalProvider";
import { logInsightsEvent } from "@/lib/insights-telemetry";

// Referral reward derives from credit-config so the menu label tracks the
// real award amount (same pattern as ReferAFriendCard / the modal).
const REFERRAL_REWARD =
  CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
    ?.proposedCredits ?? 0;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

// Rank rendering moved to <UserRankBadge /> — see
// client/src/components/UserRankBadge.tsx for the canonical
// implementation. Local map removed as part of the ranks overhaul
// to fix VoxMax Legend silently falling through to Citizen.

function XPProgressBar({ xp }: { xp: number }) {
  const { data: ranks } = useRanks();

  if (!ranks || ranks.length === 0) {
    return (
      <div className="flex items-center justify-end text-xs">
        <span className="font-mono text-amber-600 dark:text-amber-400">{xp.toLocaleString('en-US')} XP</span>
      </div>
    );
  }

  const sortedRanks = [...ranks].sort((a, b) => a.tier - b.tier);
  const currentRank =
    sortedRanks.find(r => xp >= r.minXp && (r.maxXp === null || xp <= r.maxXp)) ??
    sortedRanks[0];
  const currentIdx = sortedRanks.indexOf(currentRank);
  const nextRank = currentIdx < sortedRanks.length - 1 ? sortedRanks[currentIdx + 1] : null;

  const rankProgress = nextRank
    ? ((xp - currentRank.minXp) / (nextRank.minXp - currentRank.minXp)) * 100
    : 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end text-xs">
        <span className="font-mono text-amber-600 dark:text-amber-400">{xp.toLocaleString('en-US')} XP</span>
      </div>
      <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(rankProgress, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground text-right">
        {nextRank
          ? `${(nextRank.minXp - xp).toLocaleString()} XP to ${nextRank.name}`
          : "Max rank reached"}
      </p>
    </div>
  );
}

interface UserMenuContentProps {
  profile: UserProfile | null;
  isLoggedIn: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNavigate: (path: string) => void;
  onSignIn: () => void;
  onCreateAccount: () => void;
  onSignOut: () => void;
  onClose?: () => void;
}

function UserMenuContent({
  profile,
  isLoggedIn,
  theme,
  onToggleTheme,
  onNavigate,
  onSignIn,
  onCreateAccount,
  onSignOut,
  onClose,
}: UserMenuContentProps) {
  const { open: openReferralModal } = useReferralModal();

  const handleNavClick = (path: string) => {
    onNavigate(path);
    onClose?.();
  };

  const handleReferClick = () => {
    onClose?.();
    openReferralModal("menu");
  };

  if (!isLoggedIn) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center space-y-2">
          <div className="h-16 w-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold">Welcome to VoxDex</h3>
          <p className="text-sm text-muted-foreground">
            Sign in to track predictions, cast votes, and earn XP
          </p>
        </div>
        
        {/* Create Account is the primary CTA — most prediction-market
            and social products lead with sign-up because the LTV of a
            new account dwarfs the cost of nudging an existing user
            past one extra click. Sign In stays available right below
            in the secondary outline treatment. */}
        <div className="space-y-2">
          <Button
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500"
            onClick={onCreateAccount}
            data-testid="button-create-account"
          >
            Create Account
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={onSignIn}
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
        </div>

        <Separator />

        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/predictions/leaderboard")}
          data-testid="link-prediction-leaderboard-loggedout"
        >
          <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm">Top Predictors</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => {
            logInsightsEvent("nav", "user_menu_click", { destination: "insights" });
            handleNavClick("/insights");
          }}
          data-testid="link-insights-loggedout"
        >
          <LineChart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm">Insights</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
        </button>

        <Separator />
        
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onToggleTheme}
          data-testid="button-theme-toggle-menu"
        >
          <div className="flex items-center gap-3">
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="text-sm">Theme</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize">{theme}</span>
        </button>
      </div>
    );
  }

  const displayName = profile?.username || "User";
  const showStreakBadge = (profile?.currentStreak || 0) > 1;

  return (
    <div className="space-y-1">
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          {/* Avatar + display name route to "My Account" because that's
              the user's own dashboard — Public Profile is reachable
              from there in one click. The @handle keeps the
              social-style link to the public profile (canonical URL
              for the user). */}
          <Link
            href="/me"
            onClick={() => onClose?.()}
            className="shrink-0 rounded-full outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="link-my-account-avatar"
          >
            <UserProfileAvatar
              displayName={displayName}
              avatarUrl={profile?.avatarUrl}
              className="h-12 w-12"
            />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href="/me"
                onClick={() => onClose?.()}
                className="font-semibold truncate hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="link-my-account-name"
              >
                {displayName}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                data-testid="button-settings"
                onClick={() => handleNavClick("/me/settings")}
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </div>
            {profile?.username ? (
              <Link
                href={`/u/${profile.username}`}
                onClick={() => onClose?.()}
                className="block text-xs text-muted-foreground truncate hover:text-foreground hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="link-my-public-profile"
              >
                @{profile.username}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground truncate">@{profile?.username}</p>
            )}
            <div className="mt-1.5">
              <UserRankBadge rank={profile?.rank || "Citizen"} size="sm" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <XPProgressBar xp={profile?.xpPoints || 0} />
      </div>

      <div className="px-4 pb-3 space-y-2">
        <button
          type="button"
          className="w-full flex items-center justify-between p-2.5 rounded-lg bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30 hover:bg-violet-500/20 dark:hover:bg-violet-500/15 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/me/credits")}
          aria-label={`My Vox balance, ${(profile?.predictCredits || 0).toLocaleString("en-US")} Vox`}
          data-testid="link-my-credits-menu"
        >
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm text-muted-foreground">Vox</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm">{CURRENCY.symbol}{(profile?.predictCredits || 0).toLocaleString('en-US')}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/40 dark:border-violet-500/30 text-violet-600 dark:text-violet-400">VIRTUAL</Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-muted-foreground">Win Rate</span>
          </div>
          <span className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400">
            {profile?.winRate != null ? `${Math.round(profile.winRate)}%` : "--"}
          </span>
        </div>
        {showStreakBadge && (
          <div className="flex justify-end pt-0.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-500/50 dark:border-orange-500/40 text-orange-500 dark:text-orange-300">
              <Flame className="h-3 w-3 mr-1" />
              {profile?.currentStreak} streak
            </Badge>
          </div>
        )}
      </div>

      <Separator className="my-1" />

      <div className="px-2 py-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Activity</p>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/me")}
          data-testid="link-my-account"
        >
          <LayoutDashboard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="flex-1 text-sm">My Account</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/me/predictions")}
          data-testid="link-my-predictions"
        >
          <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="flex-1 text-sm">My Predictions</span>
          <span className="text-xs text-muted-foreground">{profile?.totalPredictions ?? 0}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/me/votes")}
          data-testid="link-my-votes"
        >
          <Vote className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <span className="flex-1 text-sm">My Votes</span>
          <span className="text-xs text-muted-foreground">{profile?.totalVotes ?? 0}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/me/credits")}
          data-testid="link-my-credits-activity"
        >
          <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="flex-1 text-sm">My Vox</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => {
            logInsightsEvent("nav", "user_menu_click", { destination: "insights" });
            handleNavClick("/insights");
          }}
          data-testid="link-insights"
        >
          <LineChart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="flex-1 text-sm">Insights</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/predictions/leaderboard")}
          data-testid="link-leaderboard"
        >
          <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-sm">Top Predictors</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        {/* How It Works — knowledge base for XP, Ranks, Vox, Badges,
            Vote, Predict. Sits above Earn Vox so users can understand
            the economy before diving into the earn loop. */}
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/how-it-works")}
          data-testid="link-how-it-works"
        >
          <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="flex-1 text-sm">How It Works</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        {/* Always-available referral entry — Phase 1 leads with earning
            (refer-and-earn pays both sides) rather than buying, so this
            sits right above Earn Vox in the same accented treatment. */}
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-violet-500/10 dark:hover:bg-violet-500/15 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={handleReferClick}
          data-testid="link-refer-earn"
        >
          <Gift className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="flex-1 text-sm font-medium text-violet-700 dark:text-violet-300">
            Refer &amp; earn {voxWord(REFERRAL_REWARD)}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        {/* Free-to-play launch: "Buy Vox" (→ /pricing) is replaced by
            "Earn Vox", which deep-links to the How It Works Vox tab's
            "Earn Vox by participating" section. Keeps the accented
            violet treatment so the economy CTA still stands out. */}
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-violet-500/10 dark:hover:bg-violet-500/15 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => handleNavClick("/how-it-works?tab=credits#earn-vox")}
          data-testid="link-earn-vox"
        >
          <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="flex-1 text-sm font-medium text-violet-700 dark:text-violet-300">
            Earn Vox
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <Separator className="my-1" />

      <div className="px-2 py-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Settings</p>
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onToggleTheme}
          data-testid="button-theme-toggle-menu"
        >
          <div className="flex items-center gap-3">
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="text-sm">Theme</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize">{theme}</span>
        </button>
      </div>

      <Separator className="my-1" />

      <div className="px-4 py-3 flex justify-end">
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-red-600 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300 hover:bg-red-500/15 dark:hover:bg-red-500/15 dark:bg-red-500/10"
          onClick={onSignOut}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </Button>
      </div>
    </div>
  );
}

export function UserMenu() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, profile, signOut } = useAuth();
  const { theme, toggleTheme } = useThemeToggle();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSheetOpen(false);
  };
  
  const handleSignIn = () => {
    navigateToLogin(setLocation);
    setSheetOpen(false);
  };
  
  const handleCreateAccount = () => {
    navigateToLogin(setLocation, { mode: "signup" });
    setSheetOpen(false);
  };
  
  const handleSignOut = async () => {
    await signOut();
    setSheetOpen(false);
    setLocation("/");
  };

  const avatarDisplayName = profile?.username || "User";

  const triggerButton = (
    <button
      className="h-9 w-9 rounded-full ring-2 ring-blue-500/30 hover:ring-blue-500/60 transition-all overflow-hidden flex items-center justify-center bg-muted focus-visible:outline-none"
      data-testid="button-user-menu"
    >
      {isLoggedIn && profile ? (
        <UserProfileAvatar
          displayName={avatarDisplayName}
          avatarUrl={profile.avatarUrl}
          className="h-full w-full"
        />
      ) : (
        <Menu className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setSheetOpen(true)}
          className="h-9 w-9 rounded-full ring-2 ring-blue-500/30 hover:ring-blue-500/60 transition-all overflow-hidden flex items-center justify-center bg-muted focus-visible:outline-none"
          data-testid="button-user-menu"
        >
          {isLoggedIn && profile ? (
            <UserProfileAvatar
              displayName={avatarDisplayName}
              avatarUrl={profile.avatarUrl}
              className="h-full w-full"
            />
          ) : (
            <Menu className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="right"
            className="w-[320px] p-0 overflow-y-auto"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>User Menu</SheetTitle>
              <SheetDescription>Account settings and navigation</SheetDescription>
            </SheetHeader>
            <UserMenuContent
              profile={profile}
              isLoggedIn={isLoggedIn}
              theme={theme}
              onToggleTheme={toggleTheme}
              onNavigate={handleNavigate}
              onSignIn={handleSignIn}
              onCreateAccount={handleCreateAccount}
              onSignOut={handleSignOut}
              onClose={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {triggerButton}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[300px] p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <UserMenuContent
          profile={profile}
          isLoggedIn={isLoggedIn}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigate={handleNavigate}
          onSignIn={handleSignIn}
          onCreateAccount={handleCreateAccount}
          onSignOut={handleSignOut}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
