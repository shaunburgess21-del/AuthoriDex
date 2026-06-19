import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Settings,
  User,
  Bell,
  Shield,
  Eye,
  Loader2,
  Vote,
  TrendingUp,
  ChevronRight,
  Camera,
  Sparkles,
  Upload,
  IdCard,
  KeyRound,
  Check,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest, parseApiError } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";
import { uploadAvatarFile, uploadGeneratedAvatar, uploadBannerFile } from "@/lib/avatar/upload";
import { getRankByName } from "@shared/rank-config";
import {
  PROFILE_BANNER_MIN_TIER,
  PROFILE_THEME_MIN_TIER,
  PROFILE_THEMES,
} from "@shared/profile-theme-config";
import { PasswordCard } from "./PasswordCard";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const RECOVERY_EMAIL_RESEND_COOLDOWN_S = 30;
const RECOVERY_EMAIL_CODE_LENGTH = 6;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible =
    local.length <= 2 ? local[0] ?? "*" : `${local.slice(0, 2)}***`;
  return `${visible}@${domain}`;
}
import { InterestsPicker } from "@/components/interests/InterestsPicker";
import { cn } from "@/lib/utils";
import { CountryCombobox } from "@/components/ui/CountryCombobox";
import { ETHNICITY_OPTIONS } from "@shared/ethnicity";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const BIO_MAX = 280;

const OCCUPATION_OPTIONS = [
  "Entertainment",
  "Sports",
  "Politics",
  "Business & Finance",
  "Music",
  "Media & Journalism",
  "Technology",
  "Healthcare",
  "Education",
  "Legal",
  "Creative & Arts",
  "Other",
] as const;

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
];

type SettingsTabId =
  | "profile"
  | "about"
  | "account"
  | "interests"
  | "privacy"
  | "notifications";

const TABS: Array<{
  id: SettingsTabId;
  label: string;
  icon: typeof User;
}> = [
  { id: "profile", label: "Profile", icon: User },
  { id: "about", label: "About Me", icon: IdCard },
  { id: "account", label: "Account", icon: KeyRound },
  { id: "interests", label: "Interests", icon: Sparkles },
  { id: "privacy", label: "Privacy", icon: Eye },
  { id: "notifications", label: "Notifications", icon: Bell },
];

export default function SettingsPage() {
  const { user, profile, profileLoading, refreshProfile, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");

  // The notifications panel keeps its own scroll-into-view behaviour
  // for the legacy `#notifications` deep link from email previews and
  // from the bell menu on smaller viewports.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    // Hash deep-links route to a tab. The legacy `#notifications`
    // link from email previews and the bell menu still works; the
    // ProfileCompletionCard on /me uses `#about` to drop users
    // straight onto the demographics form.
    const map: Record<string, SettingsTabId> = {
      profile: "profile",
      about: "about",
      account: "account",
      interests: "interests",
      privacy: "privacy",
      notifications: "notifications",
    };
    const target = map[hash];
    if (target) {
      setActiveTab(target);
      if (target === "notifications") {
        window.requestAnimationFrame(() => {
          const el = document.getElementById("notifications-panel");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Settings className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to access settings</h2>
          <Button onClick={() => navigateToLogin(setLocation)} className="mt-4" data-testid="button-sign-in">
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  if (profileLoading && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Loading your settings</h2>
          <p className="text-muted-foreground">Please wait a moment.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            aria-label="Go back"
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold">Settings</h1>
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-3xl space-y-5">
        <SettingsTabsBar
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "about" && <AboutMeTab />}
        {activeTab === "account" && <AccountTab signOut={signOut} />}
        {activeTab === "interests" && (
          <Card className="overflow-hidden">
            <InterestsPicker
              mode="settings"
              defaultValue={profile?.statedInterests ?? []}
            />
          </Card>
        )}
        {activeTab === "privacy" && <PrivacyTab />}
        {activeTab === "notifications" && (
          <div id="notifications-panel">
            <NotificationPreferences />
          </div>
        )}

        {/* Refresh helper kept usable from any tab. */}
        <div className="hidden">
          <Button onClick={() => refreshProfile()}>refresh</Button>
        </div>
      </div>
    </div>
  );
}

function SettingsTabsBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: typeof TABS;
  activeTab: SettingsTabId;
  onTabChange: (id: SettingsTabId) => void;
}) {
  return (
    <div className="-mx-2 sm:mx-0 overflow-x-auto sm:overflow-visible no-scrollbar">
      <div className="inline-flex sm:flex w-max sm:w-full items-center gap-1 sm:gap-2 px-2 sm:px-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors whitespace-nowrap",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-white/10 text-muted-foreground hover:bg-muted/40",
              )}
              data-testid={`settings-tab-${t.id}`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tab 1: Profile — avatar + username + bio + read-only email.
 * Mirrors the original Profile Information card; the bio textarea
 * is the only new control here. Same Save button drives every
 * field at once so we never end up with a half-saved state.
 */
function ProfileTab() {
  const { user, profile, profileLoading, refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile || hasLocalChanges) return;
    setUsername(profile.username || "");
    setAvatarUrl(profile.avatarUrl || "");
    setBio(profile.bio ?? "");
  }, [profile, hasLocalChanges]);

  const mutation = useMutation({
    mutationFn: async (data: { username?: string; bio?: string | null }) => {
      const res = await apiRequest("PATCH", "/api/profile/me", data);
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setHasLocalChanges(false);
      toast("Profile updated", { description: "Your changes have been saved." });
    },
    onError: () => {
      toast.error("Update failed", {
        description: "There was an error saving your changes.",
      });
    },
  });

  const normalize = (v: string | null | undefined) => (v ?? "").trim();
  const usernameInvalid =
    normalize(username).length > 0 && !USERNAME_PATTERN.test(normalize(username));
  const bioOver = bio.length > BIO_MAX;
  const isDirty = profile
    ? normalize(username) !== normalize(profile.username) ||
      normalize(bio) !== normalize(profile.bio)
    : false;

  const onSave = () => {
    mutation.mutate({
      username,
      bio: normalize(bio).length > 0 ? bio : null,
    });
  };

  const onSaveAvatar = async (seed: string) => {
    try {
      const userId = profile?.id || user!.id;
      const { url } = await uploadGeneratedAvatar(userId, seed);
      await apiRequest("PATCH", "/api/profile/avatar", {
        seed,
        avatarUrl: url,
        customizationSource: "settings",
      });
      setAvatarUrl(url);
      await refreshProfile();
      toast("Avatar updated", { description: "Looking sharp." });
    } catch (err) {
      console.error("[SettingsPage] Avatar save failed:", err);
      toast.error("Could not save avatar", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
      throw err;
    }
  };

  const onAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarUploading(true);
    try {
      const { url } = await uploadAvatarFile(file);
      await apiRequest("PATCH", "/api/profile/avatar", {
        seed: null,
        avatarUrl: url,
        customizationSource: "settings",
      });
      setAvatarUrl(url);
      await refreshProfile();
      toast("Avatar updated", { description: "Looking sharp." });
    } catch (err) {
      console.error("[SettingsPage] Avatar upload failed:", err);
      toast.error("Could not upload photo", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setAvatarUploading(false);
    }
  };

  const displayName = username || user?.email?.split("@")[0] || "User";

  return (
    <div className="space-y-6">
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <User className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold">Profile Information</h2>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <Popover open={avatarMenuOpen} onOpenChange={setAvatarMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="group relative h-20 w-20 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Change profile photo"
              disabled={avatarUploading}
              data-testid="button-open-avatar-menu"
            >
              <UserProfileAvatar
                displayName={displayName}
                avatarUrl={avatarUrl}
                className="h-20 w-20"
                fallbackClassName="text-2xl"
              />
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-30 transition-opacity duration-150 md:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              >
                {avatarUploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                ) : (
                  <Camera className="h-6 w-6 text-white" />
                )}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-muted/60 transition-colors"
              onClick={() => {
                setAvatarMenuOpen(false);
                setPickerOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4 text-violet-500" />
              <span>Pick a generative avatar</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-muted/60 transition-colors"
              onClick={() => {
                setAvatarMenuOpen(false);
                fileInputRef.current?.click();
              }}
            >
              <Upload className="h-4 w-4 text-blue-500" />
              <span>Upload a photo</span>
            </button>
          </PopoverContent>
        </Popover>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground break-all">{user?.email}</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onAvatarFile}
      />

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => {
              setHasLocalChanges(true);
              setUsername(e.target.value);
            }}
            placeholder="Choose a username"
            data-testid="input-username"
          />
          {usernameInvalid ? (
            <p className="text-xs text-destructive">
              3–30 characters, letters, numbers, or underscores only.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              This will be used for your public profile URL: /u/
              {username || "username"}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => {
              setHasLocalChanges(true);
              setBio(e.target.value);
            }}
            placeholder="Tell people a little about yourself…"
            rows={3}
            data-testid="input-bio"
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Shown on your public profile.
            </span>
            <span
              className={cn(
                "tabular-nums",
                bioOver ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {bio.length} / {BIO_MAX}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={user?.email ?? ""} disabled />
          <p className="text-xs text-muted-foreground">
            Your sign-in email. Change recovery email on the Account tab.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={onSave}
            disabled={
              !isDirty ||
              usernameInvalid ||
              bioOver ||
              mutation.isPending ||
              profileLoading ||
              !profile
            }
            data-testid="button-save-profile"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save Changes
          </Button>
          {isDirty && !mutation.isPending && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      <AvatarPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        userId={profile?.id || user!.id}
        username={profile?.username ?? undefined}
        currentSeed={profile?.avatarSeed ?? undefined}
        onSave={onSaveAvatar}
      />
    </Card>
    <RankRewardsCard />
    </div>
  );
}

/**
 * Per-tier profile visual unlocks (Phase 5). Custom banner unlocks at
 * Maven (Tier 6+), the accent theme at VoxMax Legend (Tier 8). Below
 * those tiers we show a locked teaser so the rewards are discoverable
 * without touching the public profile. Writes go through
 * PATCH /api/profile/me, which re-checks the tier server-side.
 */
function RankRewardsCard() {
  const { user, profile, refreshProfile } = useAuth();
  const tier = getRankByName(profile?.rank ?? "")?.tier ?? 1;
  const canBanner = tier >= PROFILE_BANNER_MIN_TIER;
  const canTheme = tier >= PROFILE_THEME_MIN_TIER;
  const [bannerBusy, setBannerBusy] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const bannerUrl = profile?.profileBannerUrl ?? null;
  const activeTheme = profile?.profileTheme ?? null;

  const onBannerFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBannerBusy(true);
    try {
      const userId = profile?.id || user!.id;
      const { url } = await uploadBannerFile(userId, file);
      await apiRequest("PATCH", "/api/profile/me", { profileBannerUrl: url });
      await refreshProfile();
      toast("Banner updated", { description: "Your profile is looking elite." });
    } catch (err) {
      toast.error("Could not upload banner", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBannerBusy(false);
    }
  };

  const onRemoveBanner = async () => {
    setBannerBusy(true);
    try {
      await apiRequest("PATCH", "/api/profile/me", { profileBannerUrl: null });
      await refreshProfile();
      toast("Banner removed");
    } catch (err) {
      toast.error("Could not remove banner", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBannerBusy(false);
    }
  };

  const onSelectTheme = async (key: string | null) => {
    setThemeBusy(true);
    try {
      await apiRequest("PATCH", "/api/profile/me", { profileTheme: key });
      await refreshProfile();
      toast(key ? "Theme applied" : "Theme cleared");
    } catch (err) {
      toast.error("Could not update theme", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setThemeBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold">Rank rewards</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        Visual unlocks earned by climbing the ranks. They show on your
        public profile while you hold the rank.
      </p>

      {/* Banner — Maven (Tier 6+) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Profile banner</Label>
          {!canBanner && (
            <Badge variant="outline" className="text-[10px]">
              Unlocks at Maven (Tier {PROFILE_BANNER_MIN_TIER})
            </Badge>
          )}
        </div>
        {canBanner ? (
          <div className="space-y-3">
            <div className="relative h-28 w-full overflow-hidden rounded-lg border bg-muted/40">
              {bannerUrl ? (
                <img
                  src={bannerUrl}
                  alt="Profile banner preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No banner yet
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bannerBusy}
                onClick={() => bannerInputRef.current?.click()}
              >
                {bannerBusy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {bannerUrl ? "Replace banner" : "Upload banner"}
              </Button>
              {bannerUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bannerBusy}
                  onClick={onRemoveBanner}
                >
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onBannerFile}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Reach Maven to add a custom banner to your profile.
          </p>
        )}
      </div>

      {/* Theme — VoxMax Legend (Tier 8) */}
      <div className="mt-6 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Profile theme</Label>
          {!canTheme && (
            <Badge variant="outline" className="text-[10px]">
              Unlocks at VoxMax Legend (Tier {PROFILE_THEME_MIN_TIER})
            </Badge>
          )}
        </div>
        {canTheme ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={themeBusy}
              onClick={() => onSelectTheme(null)}
              className={cn(
                "h-12 w-16 rounded-lg border text-[10px] font-medium transition-colors",
                activeTheme === null
                  ? "border-foreground ring-2 ring-foreground/30"
                  : "border-border hover:border-foreground/40",
              )}
            >
              None
            </button>
            {PROFILE_THEMES.map((theme) => (
              <button
                key={theme.key}
                type="button"
                disabled={themeBusy}
                onClick={() => onSelectTheme(theme.key)}
                title={theme.label}
                className={cn(
                  "relative h-12 w-16 overflow-hidden rounded-lg border transition-colors",
                  activeTheme === theme.key
                    ? "border-foreground ring-2 ring-foreground/30"
                    : "border-border hover:border-foreground/40",
                )}
                style={{
                  background: `linear-gradient(135deg, ${theme.gradient[0]}, ${theme.gradient[1]})`,
                }}
              >
                <span
                  className="absolute bottom-1 left-1 h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: theme.accent }}
                />
                <span className="absolute bottom-0.5 right-1 text-[9px] font-medium text-white/90">
                  {theme.label}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Reach VoxMax Legend to theme your profile page.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Tab 2: About Me — demographics + socials + occupation, plus three
 * privacy toggles (one per disclosure bucket so users can share
 * occupation without sharing socials, etc.). Save button hits
 * PATCH /api/profile/me with every field at once; the server
 * non-blockingly fans out to checkAndAwardProfileBadges so unlocking
 * the full_voxmaxer (or any field-specific) badge happens on the
 * same write that persists the value.
 */
function AboutMeTab() {
  const { profile, refreshProfile } = useAuth();

  const [bio, setBio] = useState(profile?.bio ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(
    profile?.countryOfOrigin ?? "",
  );
  const [countryOfResidence, setCountryOfResidence] = useState(
    profile?.countryOfResidence ?? "",
  );
  const [ethnicity, setEthnicity] = useState(profile?.ethnicity ?? "");
  const [socialXHandle, setSocialXHandle] = useState(
    profile?.socialXHandle ?? "",
  );
  const [socialInstagramHandle, setSocialInstagramHandle] = useState(
    profile?.socialInstagramHandle ?? "",
  );
  const [occupationIndustry, setOccupationIndustry] = useState(
    profile?.occupationIndustry ?? "",
  );
  const [dobPublic, setDobPublic] = useState(profile?.dobPublic ?? false);
  const [genderPublic, setGenderPublic] = useState(
    profile?.genderPublic ?? true,
  );
  const [countryPublic, setCountryPublic] = useState(
    profile?.countryPublic ?? true,
  );
  const [ethnicityPublic, setEthnicityPublic] = useState(
    profile?.ethnicityPublic ?? false,
  );
  const [socialHandlesPublic, setSocialHandlesPublic] = useState(
    profile?.socialHandlesPublic ?? false,
  );
  const [occupationPublic, setOccupationPublic] = useState(
    profile?.occupationPublic ?? false,
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile || dirty) return;
    setBio(profile.bio ?? "");
    setDateOfBirth(profile.dateOfBirth ?? "");
    setGender(profile.gender ?? "");
    setCountryOfOrigin(profile.countryOfOrigin ?? "");
    setCountryOfResidence(profile.countryOfResidence ?? "");
    setEthnicity(profile.ethnicity ?? "");
    setSocialXHandle(profile.socialXHandle ?? "");
    setSocialInstagramHandle(profile.socialInstagramHandle ?? "");
    setOccupationIndustry(profile.occupationIndustry ?? "");
    setDobPublic(profile.dobPublic ?? false);
    setGenderPublic(profile.genderPublic ?? true);
    setCountryPublic(profile.countryPublic ?? true);
    setEthnicityPublic(profile.ethnicityPublic ?? false);
    setSocialHandlesPublic(profile.socialHandlesPublic ?? false);
    setOccupationPublic(profile.occupationPublic ?? false);
  }, [profile, dirty]);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", "/api/profile/me", data);
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setDirty(false);
      toast("Saved", { description: "Your About Me details were updated." });
    },
    onError: () => {
      toast.error("Update failed", {
        description: "There was an error saving your changes.",
      });
    },
  });

  const onSave = () => {
    mutation.mutate({
      bio: bio.trim() || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      countryOfOrigin: countryOfOrigin.trim() || null,
      countryOfResidence: countryOfResidence.trim() || null,
      ethnicity: ethnicity.trim() || null,
      socialXHandle: socialXHandle.trim() || null,
      socialInstagramHandle: socialInstagramHandle.trim() || null,
      occupationIndustry: occupationIndustry || null,
      dobPublic,
      genderPublic,
      countryPublic,
      ethnicityPublic,
      socialHandlesPublic,
      occupationPublic,
    });
  };

  const markDirty = () => setDirty(true);

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <IdCard className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">About Me</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          This information helps us build a richer picture of our community.
          All fields are optional and private by default — you control
          what&apos;s shared.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="about-bio">Bio</Label>
            <Textarea
              id="about-bio"
              value={bio}
              onChange={(e) => {
                markDirty();
                setBio(e.target.value);
              }}
              placeholder="A short intro for your public profile."
              rows={3}
              maxLength={BIO_MAX + 50}
            />
            <div className="text-xs text-muted-foreground text-right">
              {bio.length} / {BIO_MAX}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dateOfBirth ?? ""}
              onChange={(e) => {
                markDirty();
                setDateOfBirth(e.target.value);
              }}
              data-testid="input-dob"
            />
            <p className="text-xs text-muted-foreground">
              We display age, never the raw date.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select
              value={gender || undefined}
              onValueChange={(v) => {
                markDirty();
                setGender(v);
              }}
            >
              <SelectTrigger id="gender" data-testid="select-gender">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="origin">Country of origin</Label>
            <CountryCombobox
              id="origin"
              value={countryOfOrigin || null}
              onChange={(code) => {
                markDirty();
                setCountryOfOrigin(code ?? "");
              }}
              placeholder="Search countries…"
              testId="input-country-origin"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="residence">Country of residence</Label>
            <CountryCombobox
              id="residence"
              value={countryOfResidence || null}
              onChange={(code) => {
                markDirty();
                setCountryOfResidence(code ?? "");
              }}
              placeholder="Search countries…"
              testId="input-country-residence"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="ethnicity">Ethnicity</Label>
            <Select
              value={ethnicity || undefined}
              onValueChange={(v) => {
                markDirty();
                setEthnicity(v);
              }}
            >
              <SelectTrigger id="ethnicity" data-testid="select-ethnicity">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {ETHNICITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="x-handle">X / Twitter handle</Label>
            <Input
              id="x-handle"
              value={socialXHandle ?? ""}
              onChange={(e) => {
                markDirty();
                setSocialXHandle(e.target.value);
              }}
              placeholder="@username"
              data-testid="input-x-handle"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-handle">Instagram handle</Label>
            <Input
              id="ig-handle"
              value={socialInstagramHandle ?? ""}
              onChange={(e) => {
                markDirty();
                setSocialInstagramHandle(e.target.value);
              }}
              placeholder="@username"
              data-testid="input-ig-handle"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="occupation">Occupation / Industry</Label>
            <Select
              value={occupationIndustry || undefined}
              onValueChange={(v) => {
                markDirty();
                setOccupationIndustry(v);
              }}
            >
              <SelectTrigger id="occupation" data-testid="select-occupation">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {OCCUPATION_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <h3 className="font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" /> Privacy
        </h3>
        <p className="text-xs text-muted-foreground -mt-3">
          Each toggle is independent. Hidden fields stay usable for
          eligibility on country, gender, or age-locked vote cards —
          they just won&apos;t appear on your public profile.
        </p>

        <PrivacyRow
          label="Show date of birth (age only) on my public profile"
          helper="We only ever display your age, never the raw date."
          checked={dobPublic}
          onChange={(v) => {
            markDirty();
            setDobPublic(v);
          }}
          testId="switch-dob-public"
        />
        <PrivacyRow
          label="Show gender on my public profile"
          helper="Visible by default."
          checked={genderPublic}
          onChange={(v) => {
            markDirty();
            setGenderPublic(v);
          }}
          testId="switch-gender-public"
        />
        <PrivacyRow
          label="Show country on my public profile"
          helper="Country of origin and country of residence (with flags). Visible by default."
          checked={countryPublic}
          onChange={(v) => {
            markDirty();
            setCountryPublic(v);
          }}
          testId="switch-country-public"
        />
        <PrivacyRow
          label="Show ethnicity on my public profile"
          helper="Hidden by default."
          checked={ethnicityPublic}
          onChange={(v) => {
            markDirty();
            setEthnicityPublic(v);
          }}
          testId="switch-ethnicity-public"
        />
        <PrivacyRow
          label="Show social handles on my public profile"
          helper="Adds your X and Instagram handles to your public profile."
          checked={socialHandlesPublic}
          onChange={(v) => {
            markDirty();
            setSocialHandlesPublic(v);
          }}
          testId="switch-socials-public"
        />
        <PrivacyRow
          label="Show occupation on my public profile"
          helper="Lets viewers see your selected industry."
          checked={occupationPublic}
          onChange={(v) => {
            markDirty();
            setOccupationPublic(v);
          }}
          testId="switch-occupation-public"
        />
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={onSave}
          disabled={!dirty || mutation.isPending}
          data-testid="button-save-about"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save About Me
        </Button>
        {dirty && !mutation.isPending && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

function PrivacyRow({
  label,
  helper,
  checked,
  onChange,
  testId,
}: {
  label: string;
  helper: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  // Stable id ties the visible Label to the Radix Switch so screen
  // readers announce them as a pair and (more importantly) clicking
  // the label flips the toggle. Falls back to testId when present
  // so duplicate IDs can't collide across rows.
  const reactId = useId();
  const switchId = testId ? `privacy-${testId}` : `privacy-${reactId}`;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5 min-w-0">
        <Label htmlFor={switchId}>{label}</Label>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onChange}
        data-testid={testId}
      />
    </div>
  );
}

/**
 * Tab 3: Account — recovery email, phone number, password.
 */
function AccountTab({ signOut }: { signOut: () => Promise<void> }) {
  const { profile, refreshProfile } = useAuth();
  const [recoveryEmail, setRecoveryEmail] = useState(
    profile?.recoveryEmail ?? "",
  );
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? "");
  const [dirtyEmail, setDirtyEmail] = useState(false);
  const [dirtyPhone, setDirtyPhone] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!profile) return;
    if (!dirtyEmail) setRecoveryEmail(profile.recoveryEmail ?? "");
    if (!dirtyPhone) setPhoneNumber(profile.phoneNumber ?? "");
  }, [profile, dirtyEmail, dirtyPhone]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => {
      setResendIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  const needsVerification =
    Boolean(profile?.recoveryEmail) && !profile?.recoveryEmailVerified;

  const saveEmail = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile/me", {
        recoveryEmail: recoveryEmail.trim() || null,
      });
      return res.json() as Promise<{
        verificationEmailSent?: boolean;
        recoveryEmail?: string | null;
      }>;
    },
    onSuccess: async (data) => {
      await refreshProfile();
      setDirtyEmail(false);
      setVerifyCode("");
      setVerifyError(null);
      const saved = (data.recoveryEmail ?? recoveryEmail.trim()) || null;
      if (saved && data.verificationEmailSent) {
        setResendIn(RECOVERY_EMAIL_RESEND_COOLDOWN_S);
        toast("Recovery email saved", {
          description: `Check ${maskEmail(saved)} for a verification code.`,
        });
      } else {
        toast("Recovery email saved");
      }
    },
    onError: () =>
      toast.error("Could not save recovery email", {
        description: "Please try again.",
      }),
  });

  const verifyRecoveryEmail = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest(
        "POST",
        "/api/profile/me/recovery-email/verify",
        { code },
      );
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setVerifyCode("");
      setVerifyError(null);
      toast("Recovery email verified");
    },
    onError: async (err: unknown) => {
      let message = "Could not verify code. Please try again.";
      if (err && typeof err === "object" && "message" in err) {
        const raw = String((err as { message: string }).message);
        if (raw.includes("expired")) {
          message = "That code has expired. Resend a new one.";
        } else if (raw.includes("too_many_attempts")) {
          message = "Too many attempts. Resend a new code.";
        } else if (raw.includes("invalid_code")) {
          message = "Invalid code. Check the email and try again.";
        }
      }
      setVerifyError(message);
    },
  });

  const resendVerification = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/profile/me/recovery-email/resend",
      );
      return res.json() as Promise<{
        verificationEmailSent?: boolean;
        error?: string;
      }>;
    },
    onSuccess: (data) => {
      setResendIn(RECOVERY_EMAIL_RESEND_COOLDOWN_S);
      setVerifyCode("");
      setVerifyError(null);
      if (data.error === "duplicate") {
        toast("Code already sent", {
          description: profile?.recoveryEmail
            ? `Check ${maskEmail(profile.recoveryEmail)} for your verification code.`
            : "Check your recovery email inbox.",
        });
        return;
      }
      if (profile?.recoveryEmail) {
        toast("Verification code sent", {
          description: `We sent a new code to ${maskEmail(profile.recoveryEmail)}.`,
        });
      }
    },
    onError: (err: unknown) => {
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "";
      if (raw.includes("cooldown")) {
        toast("Please wait", {
          description: "You can resend again after the countdown finishes.",
        });
        return;
      }
      toast.error("Could not resend code", {
        description: "Check your server logs or try again in a moment.",
      });
    },
  });

  const handleVerifyCodeChange = useCallback((next: string) => {
    const sanitized = next.replace(/\D/g, "").slice(0, RECOVERY_EMAIL_CODE_LENGTH);
    setVerifyCode(sanitized);
    setVerifyError(null);
  }, []);

  const savePhone = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile/me", {
        phoneNumber: phoneNumber.trim() || null,
      });
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setDirtyPhone(false);
      toast("Phone number saved");
    },
    onError: () =>
      toast.error("Could not save phone number", {
        description: "Please try again.",
      }),
  });

  return (
    <div className="space-y-5">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Account security</h2>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="recovery-email">Recovery email</Label>
            {profile?.recoveryEmailVerified ? (
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[10px]"
              >
                <Check className="h-3 w-3 mr-1" /> Verified
              </Badge>
            ) : profile?.recoveryEmail ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[10px]"
              >
                <AlertTriangle className="h-3 w-3 mr-1" /> Unverified
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="recovery-email"
              type="email"
              value={recoveryEmail}
              onChange={(e) => {
                setDirtyEmail(true);
                setRecoveryEmail(e.target.value);
              }}
              placeholder="you@example.com"
              data-testid="input-recovery-email"
            />
            <Button
              onClick={() => saveEmail.mutate()}
              disabled={!dirtyEmail || saveEmail.isPending}
              data-testid="button-save-recovery-email"
            >
              {saveEmail.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used to recover your account if you lose access. Different from
            your login email.
          </p>
          {needsVerification && profile?.recoveryEmail && (
            <div className="space-y-3 pt-2 border-t border-border/60">
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code sent to{" "}
                <span className="font-medium text-foreground">
                  {maskEmail(profile.recoveryEmail)}
                </span>
                .
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <InputOTP
                  maxLength={RECOVERY_EMAIL_CODE_LENGTH}
                  value={verifyCode}
                  onChange={handleVerifyCodeChange}
                  data-testid="input-recovery-email-otp"
                >
                  <InputOTPGroup>
                    {Array.from({ length: RECOVERY_EMAIL_CODE_LENGTH }).map(
                      (_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ),
                    )}
                  </InputOTPGroup>
                </InputOTP>
                <Button
                  size="sm"
                  onClick={() => verifyRecoveryEmail.mutate(verifyCode)}
                  disabled={
                    verifyCode.length !== RECOVERY_EMAIL_CODE_LENGTH ||
                    verifyRecoveryEmail.isPending
                  }
                  data-testid="button-verify-recovery-email"
                >
                  {verifyRecoveryEmail.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Verify
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resendVerification.mutate()}
                  disabled={
                    resendIn > 0 ||
                    resendVerification.isPending ||
                    saveEmail.isPending
                  }
                  data-testid="button-resend-recovery-email"
                >
                  {resendVerification.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {resendIn > 0 ? `Resend (${resendIn}s)` : "Resend code"}
                </Button>
              </div>
              {verifyError && (
                <p className="text-xs text-destructive">{verifyError}</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-border/60">
          <Label htmlFor="phone">Phone number</Label>
          <div className="flex items-center gap-2">
            <Input
              id="phone"
              type="tel"
              value={phoneNumber}
              onChange={(e) => {
                setDirtyPhone(true);
                setPhoneNumber(e.target.value);
              }}
              placeholder="+1 555 123 4567"
              data-testid="input-phone"
            />
            <Button
              onClick={() => savePhone.mutate()}
              disabled={!dirtyPhone || savePhone.isPending}
              data-testid="button-save-phone"
            >
              {savePhone.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used for account security. Never displayed publicly.
          </p>
        </div>
      </Card>

      <PasswordCard />

      <Card className="p-6 border-destructive/30 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-destructive" />
          <h2 className="font-semibold text-destructive">Danger Zone</h2>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Sign Out</Label>
            <p className="text-xs text-muted-foreground">
              Sign out of your account on this device
            </p>
          </div>
          <Button variant="outline" onClick={() => signOut()} data-testid="button-sign-out">
            Sign Out
          </Button>
        </div>
        <AccountDeletionRow />
      </Card>
    </div>
  );
}

type DeletionStatus = {
  pending: boolean;
  finalised: boolean;
  requestedAt: string | null;
  scheduledFor: string | null;
  deletedAt: string | null;
};

const DELETION_STATUS_KEY = ["/api/me/account/deletion-status"] as const;

function formatScheduledFor(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Danger Zone account-deletion control. Wires the existing
 * 7-day soft-delete backend (POST /api/me/account/delete,
 * POST /api/me/account/cancel-deletion, GET /api/me/account/deletion-status).
 *
 * - If a deletion is already pending: shows the scheduled date and a
 *   Cancel deletion button. The user stays logged in and can cancel
 *   any time before the window elapses.
 * - Otherwise: opens an AlertDialog with an optional reason field and
 *   a type-DELETE-to-confirm input. The server's 7-day window means
 *   no irreversible action happens until the sweeper finalises.
 * - Admin self-deletion is blocked server-side; we surface the 409
 *   message inline so operators understand the demotion handshake.
 */
function AccountDeletionRow() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const statusQuery = useQuery<DeletionStatus>({
    queryKey: DELETION_STATUS_KEY,
    staleTime: 30 * 1000,
  });

  const status = statusQuery.data;

  const scheduleMutation = useMutation({
    mutationFn: async (payload: { reason: string | null }) => {
      const res = await apiRequest("POST", "/api/me/account/delete", payload);
      return (await res.json()) as { scheduledFor: string | null; message: string };
    },
    onSuccess: async (data) => {
      setDialogOpen(false);
      setReason("");
      setConfirmText("");
      setDialogError(null);
      await queryClient.invalidateQueries({ queryKey: DELETION_STATUS_KEY });
      const when = formatScheduledFor(data.scheduledFor);
      toast("Account deletion scheduled", {
        description: when
          ? `Your account will be deleted on ${when}. You can cancel any time before then.`
          : data.message,
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // 409 admin guard — surface message inline; keep dialog open.
        try {
          const body = JSON.parse(err.message.replace(/^\d{3}:\s*/, ""));
          if (body && typeof body === "object" && typeof body.message === "string") {
            setDialogError(body.message);
            return;
          }
        } catch {
          // Fall through to toast.
        }
      }
      const parsed = parseApiError(err, "Could not schedule deletion");
      toast.error(parsed.title, { description: parsed.description });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/me/account/cancel-deletion", {});
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DELETION_STATUS_KEY });
      toast("Deletion cancelled", {
        description: "Your account is fully active again.",
      });
    },
    onError: (err) => {
      const parsed = parseApiError(err, "Could not cancel deletion");
      toast.error(parsed.title, { description: parsed.description });
    },
  });

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setReason("");
      setConfirmText("");
      setDialogError(null);
    }
  };

  // Defensive fallback. In practice an anonymised user can't reach
  // Settings (Supabase Auth row may still exist but the profile is
  // wiped), but render rather than crash if we ever do.
  if (status?.finalised) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm font-medium text-destructive">Account already deleted</p>
        <p className="text-xs text-muted-foreground mt-1">
          This account has been anonymised and cannot be recovered.
        </p>
      </div>
    );
  }

  if (status?.pending) {
    const when = formatScheduledFor(status.scheduledFor);
    return (
      <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium text-destructive">
              Account scheduled for deletion
            </p>
            <p className="text-xs text-muted-foreground">
              {when
                ? `Your account will be permanently deleted on ${when}. You can still cancel before then.`
                : "Your account is scheduled for deletion. You can still cancel before the scheduled date."}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            data-testid="button-cancel-account-deletion"
          >
            {cancelMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Cancel deletion
          </Button>
        </div>
      </div>
    );
  }

  const canConfirm = confirmText === "DELETE" && !scheduleMutation.isPending;

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="text-destructive">Delete Account</Label>
        <p className="text-xs text-muted-foreground">
          Permanently delete your account and all data
        </p>
      </div>
      <AlertDialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <Button
          variant="destructive"
          onClick={() => setDialogOpen(true)}
          disabled={statusQuery.isLoading}
          data-testid="button-delete-account"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete account
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Your account will be scheduled for deletion in{" "}
                  <span className="font-medium text-foreground">7 days</span>. You
                  can sign back in any time before then to cancel.
                </p>
                <p>
                  After the cooling-off window, your username, avatar, bio,
                  demographics, recovery email, phone number and social handles
                  will be permanently anonymised. Your public profile will be
                  hidden and any remaining predict credits will be wiped.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="deletion-reason" className="text-xs">
                Reason (optional)
              </Label>
              <Textarea
                id="deletion-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                placeholder="Tell us why you're leaving (optional)"
                rows={3}
                data-testid="input-deletion-reason"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deletion-confirm" className="text-xs">
                Type <span className="font-mono font-semibold">DELETE</span> to
                confirm
              </Label>
              <Input
                id="deletion-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-testid="input-deletion-confirm"
              />
            </div>
            {dialogError ? (
              <p role="alert" className="text-xs text-destructive">
                {dialogError}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-deletion-cancel">
              Keep my account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!canConfirm) return;
                setDialogError(null);
                scheduleMutation.mutate({
                  reason: reason.trim() ? reason.trim() : null,
                });
              }}
              disabled={!canConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-deletion-confirm"
            >
              {scheduleMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Schedule deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PrivacyTab() {
  const { profile, refreshProfile } = useAuth();
  const [, setLocation] = useLocation();
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [positionsPublic, setPositionsPublic] = useState(
    profile?.positionsPublic ?? true,
  );
  // Mirror of the per-field demographic toggles from About Me. Both
  // tabs read/write the same `profile.*Public` columns, so saving on
  // either tab updates the other after `refreshProfile()` lands.
  const [dobPublic, setDobPublic] = useState(profile?.dobPublic ?? false);
  const [genderPublic, setGenderPublic] = useState(
    profile?.genderPublic ?? true,
  );
  const [countryPublic, setCountryPublic] = useState(
    profile?.countryPublic ?? true,
  );
  const [ethnicityPublic, setEthnicityPublic] = useState(
    profile?.ethnicityPublic ?? false,
  );
  const [socialHandlesPublic, setSocialHandlesPublic] = useState(
    profile?.socialHandlesPublic ?? false,
  );
  const [occupationPublic, setOccupationPublic] = useState(
    profile?.occupationPublic ?? false,
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile || dirty) return;
    setIsPublic(profile.isPublic);
    setPositionsPublic(profile.positionsPublic ?? true);
    setDobPublic(profile.dobPublic ?? false);
    setGenderPublic(profile.genderPublic ?? true);
    setCountryPublic(profile.countryPublic ?? true);
    setEthnicityPublic(profile.ethnicityPublic ?? false);
    setSocialHandlesPublic(profile.socialHandlesPublic ?? false);
    setOccupationPublic(profile.occupationPublic ?? false);
  }, [profile, dirty]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile/me", {
        isPublic,
        positionsPublic,
        dobPublic,
        genderPublic,
        countryPublic,
        ethnicityPublic,
        socialHandlesPublic,
        occupationPublic,
      });
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setDirty(false);
      toast("Privacy updated");
    },
    onError: () =>
      toast.error("Update failed", {
        description: "There was an error saving your changes.",
      }),
  });

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Eye className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold">Privacy</h2>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Public Profile</Label>
            <p className="text-xs text-muted-foreground">
              Allow others to view your profile and activity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isPublic ? "default" : "secondary"}>
              {isPublic ? "Public" : "Private"}
            </Badge>
            <Switch
              checked={isPublic}
              onCheckedChange={(v) => {
                setDirty(true);
                setIsPublic(v);
              }}
              data-testid="switch-public-profile"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <div className="space-y-0.5">
            <Label>Show open predictions</Label>
            <p className="text-xs text-muted-foreground">
              When off, hides your open predictions on your profile and
              anonymises your activity on market feeds, Town Square, and the
              leaderboard. Your settled prediction history stays public.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={positionsPublic ? "default" : "secondary"}>
              {positionsPublic ? "Public" : "Hidden"}
            </Badge>
            <Switch
              checked={positionsPublic}
              onCheckedChange={(v) => {
                setDirty(true);
                setPositionsPublic(v);
              }}
              data-testid="switch-positions-public"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-border/60 space-y-4">
          <div className="space-y-1">
            <Label>Profile visibility</Label>
            <p className="text-xs text-muted-foreground">
              Mirrors the toggles on About Me. Hidden fields stay
              usable for eligibility on country, gender, or age-locked
              vote cards — they just won&apos;t appear on your public
              profile.
            </p>
          </div>

          <PrivacyRow
            label="Show date of birth (age only)"
            helper="We only ever display your age, never the raw date."
            checked={dobPublic}
            onChange={(v) => {
              setDirty(true);
              setDobPublic(v);
            }}
            testId="switch-dob-public-mirror"
          />
          <PrivacyRow
            label="Show gender"
            helper="Visible by default."
            checked={genderPublic}
            onChange={(v) => {
              setDirty(true);
              setGenderPublic(v);
            }}
            testId="switch-gender-public-mirror"
          />
          <PrivacyRow
            label="Show country"
            helper="Country of origin and country of residence (with flags). Visible by default."
            checked={countryPublic}
            onChange={(v) => {
              setDirty(true);
              setCountryPublic(v);
            }}
            testId="switch-country-public-mirror"
          />
          <PrivacyRow
            label="Show ethnicity"
            helper="Hidden by default."
            checked={ethnicityPublic}
            onChange={(v) => {
              setDirty(true);
              setEthnicityPublic(v);
            }}
            testId="switch-ethnicity-public-mirror"
          />
          <PrivacyRow
            label="Show social handles"
            helper="Adds your X and Instagram handles to your public profile."
            checked={socialHandlesPublic}
            onChange={(v) => {
              setDirty(true);
              setSocialHandlesPublic(v);
            }}
            testId="switch-socials-public-mirror"
          />
          <PrivacyRow
            label="Show occupation"
            helper="Lets viewers see your selected industry."
            checked={occupationPublic}
            onChange={(v) => {
              setDirty(true);
              setOccupationPublic(v);
            }}
            testId="switch-occupation-public-mirror"
          />
        </div>

        <div className="pt-2 border-t border-border/60">
          <p className="text-xs text-muted-foreground mb-2">
            Hide individual items from your profile — useful when you&apos;ve
            voted or predicted on something personal but still want to make
            your voice count.
          </p>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setLocation("/me/votes?tab=votes")}
              className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
            >
              <Vote className="h-4 w-4 text-cyan-500" />
              <span className="flex-1 text-left">Manage vote visibility</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setLocation("/me/predictions?tab=predictions")}
              className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
            >
              <TrendingUp className="h-4 w-4 text-violet-500" />
              <span className="flex-1 text-left">
                Manage prediction visibility
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => mutation.mutate()}
            disabled={!dirty || mutation.isPending}
            data-testid="button-save-privacy"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save Privacy
          </Button>
        </div>
      </div>
    </Card>
  );
}
