/**
 * Step 0 — Welcome (avatar + username + ToS).
 *
 * Lifts the body of the original WelcomePage into a step component so
 * the multi-step container can compose it. Existing behaviour preserved
 * exactly:
 *
 *   - Generative avatar preview, "Change" opens AvatarPicker.
 *   - Username with debounced availability check.
 *   - ToS + Privacy checkbox is required.
 *   - On submit: best-effort save the seeded avatar via PATCH
 *     /api/profile/avatar, then PATCH /api/profile/me/username
 *     (which stamps tos_accepted_at server-side).
 *   - Refresh profile so the rest of the app sees the new state.
 *
 * The container drives the "Continue" button and the overall layout;
 * we expose `onCompleted` so the container knows when to advance.
 * Step 0 is non-skippable, so there's no Skip path here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker } from "@/components/avatar/AvatarPicker";
import { GenerativeAvatar } from "@/components/avatar/GenerativeAvatar";
import { uploadGeneratedAvatar } from "@/lib/avatar/upload";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, apiRequest } from "@/lib/queryClient";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const DEBOUNCE_MS = 400;

type Availability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok" }
  | { status: "taken" }
  | { status: "invalid"; reason: string }
  | { status: "error" };

interface WelcomeStepProps {
  /** Called after the username + ToS PATCH lands successfully. */
  onCompleted: () => void;
}

export function WelcomeStep({ onCompleted }: WelcomeStepProps) {
  const { user, profile, refreshProfile } = useAuth();

  const [username, setUsername] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ status: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const initializedRef = useRef(false);
  const initialUsernameRef = useRef<string>("");

  // Pre-fill from the auto-generated handle once the profile lands.
  // Mirrors the original WelcomePage's defensive behaviour: we treat
  // a pre-existing handle as "available" without firing a check.
  useEffect(() => {
    if (initializedRef.current) return;
    if (!profile?.username) return;
    initializedRef.current = true;
    initialUsernameRef.current = profile.username;
    setUsername(profile.username);
    setAvailability({ status: "ok" });
  }, [profile?.username]);

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
        reason: "3–30 letters, numbers, or underscores.",
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
        console.error("[WelcomeStep] Avatar save failed:", err);
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
        // Best-effort: persist the seeded avatar if the user never
        // opened the picker. A failure here mustn't block onboarding —
        // they can re-roll from Settings any time.
        const seed = profile?.avatarSeed;
        const userIdForAvatar = profile?.id || user?.id;
        if (!profile?.avatarUrl && seed && userIdForAvatar) {
          try {
            const { url } = await uploadGeneratedAvatar(userIdForAvatar, seed);
            await apiRequest("PATCH", "/api/profile/avatar", {
              seed,
              avatarUrl: url,
            });
          } catch (avatarErr) {
            console.warn(
              "[WelcomeStep] Auto-save default avatar failed; continuing:",
              avatarErr,
            );
            toast.error("Couldn't save your avatar", {
              description: "Don't worry — you can pick one in Settings any time.",
            });
          }
        }

        await apiRequest("PATCH", "/api/profile/me/username", {
          username: username.trim(),
          tosAccepted: true,
        });
        await refreshProfile();
        onCompleted();
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
    [
      canSubmit,
      username,
      refreshProfile,
      onCompleted,
      profile?.avatarUrl,
      profile?.avatarSeed,
      profile?.id,
      user?.id,
    ],
  );

  return (
    <form
      id="onboarding-welcome-form"
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col gap-6"
      noValidate
    >
      <div className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="h-16 w-16 overflow-hidden rounded-full border border-border/60 bg-muted flex-shrink-0">
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
            className="h-12 pr-10 text-base"
          />
          <div className="absolute inset-y-0 right-3 flex items-center">
            <UsernameStatusIcon availability={availability} />
          </div>
        </div>
        <UsernameStatusText availability={availability} username={username} />
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/30 p-4">
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

      {/* Pull the submit button to the bottom of the body so the
          container's footer slot can render an external Continue
          (which submits this form via the form="…" attribute). */}
      <div className="mt-auto pt-2">
        <Button
          type="submit"
          className="w-full"
          size="lg"
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
      </div>

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
    </form>
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
        3–30 letters, numbers, or underscores.
      </p>
    );
  }
  switch (availability.status) {
    case "checking":
      return <p className="text-xs text-muted-foreground">Checking availability…</p>;
    case "ok":
      return <p className="text-xs text-emerald-500">Available.</p>;
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
          3–30 letters, numbers, or underscores.
        </p>
      );
  }
}
