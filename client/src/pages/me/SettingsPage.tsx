import { useEffect, useId, useRef, useState } from "react";
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
} from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";
import { uploadAvatarFile, uploadGeneratedAvatar } from "@/lib/avatar/upload";
import { PasswordCard } from "./PasswordCard";
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
      await apiRequest("PATCH", "/api/profile/avatar", { seed, avatarUrl: url });
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
 * Verification flow for the recovery email is intentionally
 * deferred: storing a value already sets verified=false on the
 * server, so a future verification handler can flip it without
 * any frontend changes here.
 */
function AccountTab({ signOut }: { signOut: () => Promise<void> }) {
  const { profile, refreshProfile } = useAuth();
  const [recoveryEmail, setRecoveryEmail] = useState(
    profile?.recoveryEmail ?? "",
  );
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? "");
  const [dirtyEmail, setDirtyEmail] = useState(false);
  const [dirtyPhone, setDirtyPhone] = useState(false);

  useEffect(() => {
    if (!profile) return;
    if (!dirtyEmail) setRecoveryEmail(profile.recoveryEmail ?? "");
    if (!dirtyPhone) setPhoneNumber(profile.phoneNumber ?? "");
  }, [profile, dirtyEmail, dirtyPhone]);

  const saveEmail = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile/me", {
        recoveryEmail: recoveryEmail.trim() || null,
      });
      return res.json();
    },
    onSuccess: async () => {
      await refreshProfile();
      setDirtyEmail(false);
      toast("Recovery email saved");
    },
    onError: () =>
      toast.error("Could not save recovery email", {
        description: "Please try again.",
      }),
  });

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
            {profile?.recoveryEmail && !profile?.recoveryEmailVerified
              ? " Verification coming soon."
              : ""}
          </p>
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
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-destructive">Delete Account</Label>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all data
            </p>
          </div>
          <Button variant="destructive" disabled>
            Coming Soon
          </Button>
        </div>
      </Card>
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
