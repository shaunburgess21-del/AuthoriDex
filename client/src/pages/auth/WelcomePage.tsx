/**
 * /login/welcome — one-time onboarding for first-time authenticated users.
 * Pre-fills the auto-generated username from `/api/profile/sync`, lets the
 * user adjust it (with debounced availability checks), shows their seeded
 * generative avatar with a "Change avatar" affordance, and gates submit on
 * Terms + Privacy acceptance. On success calls PATCH /api/profile/me/username
 * (which also writes `tos_accepted_at`) and redirects to `/`.
 *
 * Bounce rules:
 *   - Unauthenticated visitors → /login
 *   - Returning users with `tosAcceptedAt` already set → /
 *
 * The `initialUsernameRef` lets us treat the seeded auto-generated username
 * as "available" without firing a wasteful availability check on mount.
 *
 * Avatar flow:
 *   New users land here with an auto-generated `avatarSeed` from
 *   /api/profile/sync. They can either keep it (do nothing) or open the
 *   AvatarPicker modal to choose another. Picker save commits immediately
 *   (uploads PNG to Supabase Storage + PATCH /api/profile/avatar), mirroring
 *   the Settings page flow — so the avatar is persisted independently of
 *   the username/ToS submit and survives page reloads mid-onboarding.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { GenerativeAvatar } from "@/components/avatar/GenerativeAvatar";
import { uploadGeneratedAvatar } from "@/lib/avatar/upload";

import { useAuth } from "@/contexts/AuthContext";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { redirectAfterLogin, hasPendingAuthReturnSnapshot } from "@/lib/authReturn";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const DEBOUNCE_MS = 400;

type Availability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok" }
  | { status: "taken" }
  | { status: "invalid"; reason: string }
  | { status: "error" };

export default function WelcomePage() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, profile, profileLoading, refreshProfile } = useAuth();

  const [username, setUsername] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ status: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const initializedRef = useRef(false);
  const initialUsernameRef = useRef<string>("");

  // Bounce: unauth users → /login, returning users with ToS already accepted
  // → home (or any pending auth-return snapshot).
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLocation("/login", { replace: true });
      return;
    }
    if (profileLoading) return;
    if (profile?.tosAcceptedAt) {
      if (hasPendingAuthReturnSnapshot()) {
        redirectAfterLogin(setLocation);
      } else {
        setLocation("/", { replace: true });
      }
    }
  }, [authLoading, user, profile, profileLoading, setLocation]);

  // Pre-fill from auto-generated username once the profile lands. The ref
  // guard means we won't clobber the user's edits if the profile object
  // updates again (e.g. after a refresh).
  useEffect(() => {
    if (initializedRef.current) return;
    if (!profile?.username) return;
    initializedRef.current = true;
    initialUsernameRef.current = profile.username;
    setUsername(profile.username);
    setAvailability({ status: "ok" });
  }, [profile?.username]);

  // Debounced availability check. Skips the check if the value is the
  // auto-generated username we already trust from /api/profile/sync.
  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      setAvailability({ status: "idle" });
      return;
    }
    if (trimmed === initialUsernameRef.current) {
      setAvailability({ status: "ok" });
      return;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
      setAvailability({
        status: "invalid",
        reason: "3–20 letters, numbers, or underscores.",
      });
      return;
    }

    setAvailability({ status: "checking" });
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/profile/username-available?username=${encodeURIComponent(trimmed)}`,
        );
        const data = (await res.json()) as { available?: boolean };
        if (cancelled) return;
        setAvailability(data.available ? { status: "ok" } : { status: "taken" });
      } catch {
        if (!cancelled) setAvailability({ status: "error" });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [username]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!tosAccepted) return false;
    const trimmed = username.trim();
    if (!trimmed) return false;
    if (trimmed === initialUsernameRef.current) return true;
    if (!USERNAME_PATTERN.test(trimmed)) return false;
    return availability.status === "ok";
  }, [submitting, tosAccepted, username, availability.status]);

  // Mirrors SettingsPage's avatar save: render seed → upload PNG →
  // PATCH /api/profile/avatar → refresh profile so the new avatar
  // shows everywhere (including this card). The picker handles its
  // own loading state; we just need to throw on error so it stays
  // open with feedback rather than closing as if successful.
  const handleSaveAvatar = useCallback(
    async (seed: string) => {
      if (!user) return;
      try {
        const userId = profile?.id || user.id;
        const { url } = await uploadGeneratedAvatar(userId, seed);
        await apiRequest("PATCH", "/api/profile/avatar", {
          seed,
          avatarUrl: url,
        });
        await refreshProfile();
        toast.success("Avatar updated", { description: "Looking sharp." });
      } catch (err) {
        console.error("[WelcomePage] Avatar save failed:", err);
        toast.error("Could not save avatar", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        throw err;
      }
    },
    [user, profile?.id, refreshProfile],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await apiRequest("PATCH", "/api/profile/me/username", {
          username: username.trim(),
          tosAccepted: true,
        });
        await refreshProfile();
        toast.success("You're in", { description: "Welcome to VoxDex." });
        if (hasPendingAuthReturnSnapshot()) {
          redirectAfterLogin(setLocation);
        } else {
          setLocation("/", { replace: true });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setAvailability({ status: "taken" });
          setSubmitError("That username was just taken — try another.");
        } else {
          setSubmitError(
            err instanceof Error ? err.message : "Something went wrong. Please try again.",
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, username, refreshProfile, setLocation],
  );

  if (authLoading || !user) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <VoxDexLogo size={48} />
            <span className="font-serif font-bold text-3xl">VoxDex</span>
          </div>
          <p className="text-muted-foreground">Pick a handle and you're in.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome to VoxDex</CardTitle>
            <CardDescription>
              Choose a username for your public profile. You can change it later in Settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Avatar preview + Change-avatar affordance.
                  Shown above the username field on purpose: the
                  username is the user's "name" and the avatar is
                  their "face" — pairing them visually previews how
                  their identity will read across the product. */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-full border bg-muted flex-shrink-0">
                  {profile?.avatarSeed ? (
                    <GenerativeAvatar seed={profile.avatarSeed} alt="Your avatar" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Your avatar</p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    We auto-generated one — keep it or pick something else.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  data-testid="button-welcome-change-avatar"
                  disabled={!user}
                >
                  Change
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="welcome-username">Username</Label>
                <div className="relative">
                  <Input
                    id="welcome-username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="yourname"
                    data-testid="input-welcome-username"
                    className="pr-10"
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <UsernameStatusIcon availability={availability} />
                  </div>
                </div>
                <UsernameStatusText availability={availability} username={username} />
              </div>

              <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
                <Checkbox
                  id="welcome-tos"
                  checked={tosAccepted}
                  onCheckedChange={(c) => setTosAccepted(c === true)}
                  data-testid="checkbox-tos"
                  className="mt-0.5"
                />
                <Label htmlFor="welcome-tos" className="text-sm font-normal leading-snug">
                  I agree to the{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                  .
                </Label>
              </div>

              {submitError ? (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={!canSubmit}
                data-testid="button-welcome-submit"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Mounted at the page root so the dialog escapes the card's
          stacking context. Only renders an interactive picker when
          we have a user id to attach the upload to. */}
      {user ? (
        <AvatarPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          userId={profile?.id || user.id}
          username={profile?.username}
          currentSeed={profile?.avatarSeed}
          onSave={handleSaveAvatar}
        />
      ) : null}
    </div>
  );
}

function UsernameStatusIcon({ availability }: { availability: Availability }) {
  switch (availability.status) {
    case "checking":
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    case "ok":
      return <Check className="h-4 w-4 text-emerald-500" />;
    case "taken":
    case "invalid":
    case "error":
      return <X className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
}

function UsernameStatusText({
  availability,
  username,
}: {
  availability: Availability;
  username: string;
}) {
  if (!username.trim()) {
    return (
      <p className="text-xs text-muted-foreground">
        3–20 letters, numbers, or underscores.
      </p>
    );
  }
  switch (availability.status) {
    case "checking":
      return <p className="text-xs text-muted-foreground">Checking availability…</p>;
    case "ok":
      return <p className="text-xs text-emerald-600">Available.</p>;
    case "taken":
      return <p className="text-xs text-destructive">That username is taken.</p>;
    case "invalid":
      return <p className="text-xs text-destructive">{availability.reason}</p>;
    case "error":
      return (
        <p className="text-xs text-destructive">
          Couldn't check availability. Try again in a moment.
        </p>
      );
    default:
      return (
        <p className="text-xs text-muted-foreground">
          3–20 letters, numbers, or underscores.
        </p>
      );
  }
}
