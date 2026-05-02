import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

export default function SettingsPage() {
  const { user, profile, profileLoading, refreshProfile, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState(profile?.username || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Hidden file input for the "Upload a photo" branch of the camera+
  // popover. Kept on the page (not inside the popover content) so the
  // input survives popover open/close cycles and we don't lose the
  // selected file mid-flow.
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile || hasLocalChanges) {
      return;
    }

    setUsername(profile.username || "");
    setAvatarUrl(profile.avatarUrl || "");
    setIsPublic(profile.isPublic);
  }, [profile, hasLocalChanges]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { username?: string; isPublic?: boolean }) => {
      const response = await apiRequest("PATCH", "/api/profile/me", data);
      return response.json();
    },
    onSuccess: async () => {
      // refreshProfile fetches /api/profile/me directly; no need to also invalidate
      await refreshProfile();
      setHasLocalChanges(false);
      toast("Profile updated", { description: "Your changes have been saved." });
    },
    onError: () => {
      toast.error("Update failed", { description: "There was an error saving your changes." });
    },
  });

  const normalize = (v: string | null | undefined) => (v ?? "").trim();
  // Avatar deliberately NOT included in the dirty-check anymore — picker
  // and file upload both PATCH /api/profile/avatar themselves and refresh
  // the profile, so by the time control returns the avatar is already
  // persisted. Including it here would leave Save Changes glowing
  // "Unsaved" forever after every avatar swap.
  const isDirty = profile
    ? normalize(username) !== normalize(profile.username) ||
      isPublic !== profile.isPublic
    : false;

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      username,
      isPublic,
    });
  };

  const handleSaveAvatar = async (seed: string) => {
    try {
      const userId = profile?.id || user!.id;
      const { url } = await uploadGeneratedAvatar(userId, seed);

      await apiRequest("PATCH", "/api/profile/avatar", {
        seed,
        avatarUrl: url,
      });

      setAvatarUrl(url);
      await refreshProfile();

      toast("Avatar updated", { description: "Looking sharp." });
    } catch (err) {
      console.error("[SettingsPage] Avatar save failed:", err);
      toast.error("Could not save avatar", { description: err instanceof Error ? err.message : "Please try again." });
      throw err;
    }
  };

  // Camera+ popover → "Upload a photo" branch. We stage the file out of
  // the input element immediately (before any async work) so that quick
  // re-uploads of a different file fire correctly: the input's
  // `onChange` only fires when the *value* changes, and we reset it
  // below so picking the same filename twice still works.
  const handleAvatarFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarUploading(true);
    try {
      const { url } = await uploadAvatarFile(file);

      // Pass `seed: null` so the server clears the avatarSeed alongside
      // the URL — uploaded photos and generated seeds are mutually
      // exclusive sources of truth for a profile's avatar.
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

  const handleDeleteAccount = async () => {
    if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      toast.error("Account deletion", { description: "Account deletion is not yet implemented." });
    }
  };

  const displayName = username || user?.email?.split("@")[0] || "User";

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
              if (window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/me");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold">Settings</h1>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-6">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <User className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Profile Information</h2>
          </div>
          
          <div className="flex items-center gap-4 mb-6">
            {/* Polymarket-style avatar control: a centered scrim with a
                Camera icon fills the avatar circle on hover (desktop)
                and stays faintly visible on touch devices for
                discoverability. Clicking opens a popover with the two
                ways to change the avatar. */}
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
                  data-testid="button-pick-generative-avatar"
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
                  data-testid="button-upload-avatar-photo"
                >
                  <Upload className="h-4 w-4 text-blue-500" />
                  <span>Upload a photo</span>
                </button>
              </PopoverContent>
            </Popover>
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground break-all">{user.email}</p>
            </div>
          </div>

          {/* Hidden file input — triggered programmatically from the
              "Upload a photo" popover item. PNG/JPG/WEBP up to 5 MB
              (validated client-side in uploadAvatarFile). */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleAvatarFileSelected}
            data-testid="input-avatar-file"
          />

          <div className="space-y-4">
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
              <p className="text-xs text-muted-foreground">
                This will be used for your public profile URL: /u/{username || "username"}
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSaveProfile}
                disabled={!isDirty || updateProfileMutation.isPending || profileLoading || !profile}
                data-testid="button-save-profile"
              >
                {updateProfileMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              {isDirty && !updateProfileMutation.isPending && (
                <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
                  Unsaved changes
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <InterestsPicker
            mode="settings"
            defaultValue={profile?.statedInterests ?? []}
          />
        </Card>

        <PasswordCard />

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
                  onCheckedChange={(checked) => {
                    setHasLocalChanges(true);
                    setIsPublic(checked);
                  }}
                  data-testid="switch-public-profile"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border/60">
              <p className="text-xs text-muted-foreground mb-2">
                Hide individual items from your profile — useful when you&apos;ve voted or predicted on
                something personal but still want to make your voice count.
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setLocation("/me/votes?tab=votes")}
                  className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                  data-testid="link-manage-vote-visibility"
                >
                  <Vote className="h-4 w-4 text-cyan-500" />
                  <span className="flex-1 text-left">Manage vote visibility</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/me/predictions?tab=predictions")}
                  className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                  data-testid="link-manage-prediction-visibility"
                >
                  <TrendingUp className="h-4 w-4 text-violet-500" />
                  <span className="flex-1 text-left">Manage prediction visibility</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </Card>

        <NotificationPreferences />

        <Card className="p-6 border-destructive/30">
          <div className="flex items-center gap-2 mb-6">
            <Shield className="h-5 w-5 text-destructive" />
            <h2 className="font-semibold text-destructive">Danger Zone</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Sign Out</Label>
                <p className="text-xs text-muted-foreground">
                  Sign out of your account on this device
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => signOut()}
                data-testid="button-sign-out"
              >
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
              <Button 
                variant="destructive" 
                disabled
                data-testid="button-delete-account"
                title="Account deletion coming soon"
              >
                Coming Soon
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <AvatarPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        userId={profile?.id || user!.id}
        username={profile?.username}
        currentSeed={profile?.avatarSeed}
        onSave={handleSaveAvatar}
      />
    </div>
  );
}
