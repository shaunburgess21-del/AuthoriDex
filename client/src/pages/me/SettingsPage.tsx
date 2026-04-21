import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Settings, User, Bell, Shield, Eye, Loader2, Vote, TrendingUp, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { UploadImageInput } from "@/components/ui/upload-image-input";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { uploadGeneratedAvatar } from "@/lib/avatar/upload";

export default function SettingsPage() {
  const { user, profile, profileLoading, refreshProfile, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [username, setUsername] = useState(profile?.username || "");
  const [fullName, setFullName] = useState(profile?.fullName || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!profile || hasLocalChanges) {
      return;
    }

    setUsername(profile.username || "");
    setFullName(profile.fullName || "");
    setAvatarUrl(profile.avatarUrl || "");
    setIsPublic(profile.isPublic);
  }, [profile, hasLocalChanges]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { username?: string; fullName?: string; avatarUrl?: string | null; isPublic?: boolean }) => {
      const response = await apiRequest("PATCH", "/api/profile/me", data);
      return response.json();
    },
    onSuccess: async () => {
      // refreshProfile fetches /api/profile/me directly; no need to also invalidate
      await refreshProfile();
      setHasLocalChanges(false);
      toast({
        title: "Profile updated",
        description: "Your changes have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "There was an error saving your changes.",
        variant: "destructive",
      });
    },
  });

  const normalize = (v: string | null | undefined) => (v ?? "").trim();
  const isDirty = profile
    ? normalize(username) !== normalize(profile.username) ||
      normalize(fullName) !== normalize(profile.fullName) ||
      normalize(avatarUrl) !== normalize(profile.avatarUrl) ||
      isPublic !== profile.isPublic
    : false;

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      username,
      fullName,
      avatarUrl: avatarUrl.trim() || null,
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

      toast({
        title: "Avatar updated",
        description: "Looking sharp.",
      });
    } catch (err) {
      console.error("[SettingsPage] Avatar save failed:", err);
      toast({
        title: "Could not save avatar",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleDeleteAccount = async () => {
    if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      toast({
        title: "Account deletion",
        description: "Account deletion is not yet implemented.",
        variant: "destructive",
      });
    }
  };

  const displayName = fullName || username || user?.email?.split("@")[0] || "User";

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
            <div className="relative">
              <UserProfileAvatar
                displayName={displayName}
                avatarUrl={avatarUrl}
                className="h-20 w-20"
                fallbackClassName="text-2xl"
              />
            </div>
            <div>
              <p className="font-medium">{displayName}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="mb-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              data-testid="button-open-avatar-picker"
            >
              Change avatar
            </Button>
          </div>

          <div className="mb-6 space-y-2">
            <Label>Profile Photo</Label>
            <UploadImageInput
              value={avatarUrl}
              onChange={(url) => {
                setHasLocalChanges(true);
                setAvatarUrl(url);
              }}
              moduleName="avatars"
              slugOrId={profile?.id || user.id}
              disabled={updateProfileMutation.isPending}
              placeholder="Paste an image URL or upload a photo"
              hidePreview
              buttonAriaLabel="Change profile photo"
              buttonTestId="button-change-avatar"
            />
            <p className="text-xs text-muted-foreground">
              Upload PNG, JPG, or WEBP up to 2MB. Save changes to apply it to your profile.
            </p>
          </div>

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
            
            <div className="space-y-2">
              <Label htmlFor="fullName">Display Name</Label>
              <Input 
                id="fullName" 
                value={fullName}
                onChange={(e) => {
                  setHasLocalChanges(true);
                  setFullName(e.target.value);
                }}
                placeholder="Your display name"
                data-testid="input-fullname"
              />
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

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label>Email Notifications</Label>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    Coming soon
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Receive updates about your predictions and votes
                </p>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="Email notifications (coming soon)"
                data-testid="switch-email-notifications"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label>Prediction Alerts</Label>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    Coming soon
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get notified when your predictions resolve
                </p>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="Prediction alerts (coming soon)"
                data-testid="switch-prediction-alerts"
              />
            </div>
          </div>
        </Card>

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
