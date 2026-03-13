import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Settings, User, Bell, Shield, Eye, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { UploadImageInput } from "@/components/ui/upload-image-input";
import { getAvatarInitials, HUMAN_AVATAR_FALLBACK_CLASS } from "@/lib/avatar";

export default function SettingsPage() {
  const { user, profile, profileLoading, refreshProfile, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [username, setUsername] = useState(profile?.username || "");
  const [fullName, setFullName] = useState(profile?.fullName || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);

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
      await refreshProfile();
      setHasLocalChanges(false);
      toast({
        title: "Profile updated",
        description: "Your changes have been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "There was an error saving your changes.",
        variant: "destructive",
      });
    },
  });

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      username,
      fullName,
      avatarUrl: avatarUrl.trim() || null,
      isPublic,
    });
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
          <Button onClick={() => setLocation("/login")} className="mt-4" data-testid="button-sign-in">
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
              <Avatar className="h-20 w-20">
                {avatarUrl ? (
                  <AvatarImage src={avatarUrl} alt={displayName} />
                ) : (
                  <AvatarFallback className={`${HUMAN_AVATAR_FALLBACK_CLASS} text-2xl`}>
                    {getAvatarInitials(displayName)}
                  </AvatarFallback>
                )}
              </Avatar>
            </div>
            <div>
              <p className="font-medium">{displayName}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
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

            <Button 
              onClick={handleSaveProfile}
              disabled={updateProfileMutation.isPending || profileLoading || !profile}
              data-testid="button-save-profile"
            >
              {updateProfileMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
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
                <Label>Email Notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Receive updates about your predictions and votes
                </p>
              </div>
              <Switch data-testid="switch-email-notifications" />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Prediction Alerts</Label>
                <p className="text-xs text-muted-foreground">
                  Get notified when your predictions resolve
                </p>
              </div>
              <Switch defaultChecked data-testid="switch-prediction-alerts" />
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
                onClick={handleDeleteAccount}
                data-testid="button-delete-account"
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
