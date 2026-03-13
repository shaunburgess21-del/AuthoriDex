import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, UserProfile } from "@/contexts/AuthContext";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getAvatarInitials, getAvatarGradient, HUMAN_AVATAR_FALLBACK_CLASS } from "@/lib/avatar";
import { 
  User,
  Menu,
  Trophy, 
  Vote, 
  Settings, 
  LogOut, 
  Sun, 
  Moon, 
  Shield, 
  Sparkles,
  ChevronRight,
  TrendingUp,
  Zap,
  Wallet,
  LayoutDashboard,
  Flame,
} from "lucide-react";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const root = document.documentElement;
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
    root.classList.toggle("dark", initialTheme === "dark");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
    localStorage.setItem("theme", newTheme);
  };

  return { theme, toggleTheme };
}

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

function RankBadgeDisplay({ rank }: { rank: string }) {
  const badgeConfig: Record<string, { color: string; icon: typeof User }> = {
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
    <Badge variant="outline" className={`${config.color} text-xs`}>
      <Icon className="h-3 w-3 mr-1" />
      {rank}
    </Badge>
  );
}

function XPProgressBar({ xp, level }: { xp: number; level: number }) {
  const xpForCurrentLevel = (level - 1) * 500;
  const xpForNextLevel = level * 500;
  const progress = ((xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Level {level}</span>
        <span className="font-mono text-amber-400">{xp.toLocaleString('en-US')} XP</span>
      </div>
      <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground text-right">
        {xpForNextLevel - xp} XP to Level {level + 1}
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
  const handleNavClick = (path: string) => {
    onNavigate(path);
    onClose?.();
  };

  if (!isLoggedIn) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center space-y-2">
          <div className="h-16 w-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold">Welcome to AuthoriDex</h3>
          <p className="text-sm text-muted-foreground">
            Sign in to track predictions, cast votes, and earn XP
          </p>
        </div>
        
        <div className="space-y-2">
          <Button 
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500"
            onClick={onSignIn}
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
          <Button 
            variant="outline" 
            className="w-full"
            onClick={onCreateAccount}
            data-testid="button-create-account"
          >
            Create Account
          </Button>
        </div>

        <Separator />

        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          onClick={() => handleNavClick("/predictions/leaderboard")}
          data-testid="link-prediction-leaderboard-loggedout"
        >
          <Trophy className="h-4 w-4 text-amber-400" />
          <span className="text-sm">Top Predictors</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
        </button>

        <Separator />
        
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
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

  const displayName = profile?.fullName || profile?.username || "User";
  const xpLevel = Math.floor((profile?.xpPoints || 0) / 500) + 1;

  return (
    <div className="space-y-1">
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 rounded-full">
            {profile?.avatarUrl ? (
              <AvatarImage src={profile.avatarUrl} alt={displayName} />
            ) : (
              <AvatarFallback className={`rounded-full ${getAvatarGradient(displayName)} ${HUMAN_AVATAR_FALLBACK_CLASS}`}>
                {getAvatarInitials(displayName)}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{displayName}</h3>
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
            <p className="text-xs text-muted-foreground truncate">@{profile?.username}</p>
            <div className="mt-1.5">
              <RankBadgeDisplay rank={profile?.rank || "Citizen"} />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <XPProgressBar xp={profile?.xpPoints || 0} level={xpLevel} />
      </div>

      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/30">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-violet-400" />
            <span className="text-sm text-muted-foreground">Credits</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm">{(profile?.predictCredits || 0).toLocaleString('en-US')}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-400">VIRTUAL</Badge>
          </div>
        </div>
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            <span className="text-sm text-muted-foreground">Win Streak</span>
          </div>
          <span className="font-mono font-bold text-sm text-orange-400">{profile?.currentStreak || 0}</span>
        </div>
      </div>

      <Separator className="my-1" />

      <div className="px-2 py-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Activity</p>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          onClick={() => handleNavClick("/me")}
          data-testid="link-my-account"
        >
          <LayoutDashboard className="h-4 w-4 text-blue-400" />
          <span className="flex-1 text-sm">My Account</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          onClick={() => handleNavClick("/me/predictions")}
          data-testid="link-my-predictions"
        >
          <TrendingUp className="h-4 w-4 text-violet-400" />
          <span className="flex-1 text-sm">My Predictions</span>
          <span className="text-xs text-muted-foreground">{profile?.totalPredictions ?? 0}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          onClick={() => handleNavClick("/me/votes")}
          data-testid="link-my-votes"
        >
          <Vote className="h-4 w-4 text-cyan-400" />
          <span className="flex-1 text-sm">My Votes</span>
          <span className="text-xs text-muted-foreground">{profile?.totalVotes ?? 0}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
          onClick={() => handleNavClick("/predictions/leaderboard")}
          data-testid="link-leaderboard"
        >
          <Trophy className="h-4 w-4 text-amber-400" />
          <span className="flex-1 text-sm">Top Predictors</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            <Zap className="h-2.5 w-2.5 mr-0.5" />
            {profile?.winRate != null ? `${Math.round(profile.winRate)}%` : "--"}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <Separator className="my-1" />

      <div className="px-2 py-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Settings</p>
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
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
          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
  const { theme, toggleTheme } = useTheme();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleNavigate = (path: string) => {
    setLocation(path);
    setSheetOpen(false);
  };
  
  const handleSignIn = () => {
    setLocation("/login");
    setSheetOpen(false);
  };
  
  const handleCreateAccount = () => {
    setLocation("/login?mode=signup");
    setSheetOpen(false);
  };
  
  const handleSignOut = async () => {
    await signOut();
    setSheetOpen(false);
    setLocation("/");
  };

  const avatarDisplayName = profile?.fullName || profile?.username || "User";

  const triggerButton = (
    <button
      className="h-9 w-9 rounded-full ring-2 ring-blue-500/30 hover:ring-blue-500/60 transition-all overflow-hidden flex items-center justify-center bg-muted"
      data-testid="button-user-menu"
    >
      {isLoggedIn && profile ? (
        profile.avatarUrl ? (
          <img 
            src={profile.avatarUrl} 
            alt={avatarDisplayName} 
            className="h-full w-full object-cover"
          />
        ) : (
          <div className={`h-full w-full flex items-center justify-center text-sm ${getAvatarGradient(avatarDisplayName)} ${HUMAN_AVATAR_FALLBACK_CLASS}`}>
            {getAvatarInitials(avatarDisplayName)}
          </div>
        )
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
          className="h-9 w-9 rounded-full ring-2 ring-blue-500/30 hover:ring-blue-500/60 transition-all overflow-hidden flex items-center justify-center bg-muted"
          data-testid="button-user-menu"
        >
          {isLoggedIn && profile ? (
            profile.avatarUrl ? (
              <img 
                src={profile.avatarUrl} 
                alt={avatarDisplayName} 
                className="h-full w-full object-cover"
              />
            ) : (
              <div className={`h-full w-full flex items-center justify-center text-sm ${getAvatarGradient(avatarDisplayName)} ${HUMAN_AVATAR_FALLBACK_CLASS}`}>
                {getAvatarInitials(avatarDisplayName)}
              </div>
            )
          ) : (
            <Menu className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-[320px] p-0 overflow-y-auto">
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
      <DropdownMenuContent align="end" className="w-[300px] p-0">
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
