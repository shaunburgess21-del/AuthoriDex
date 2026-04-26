/**
 * Settings → Password card.
 *
 * Lets the signed-in user set or change their Supabase password. Supabase
 * doesn't expose a clean "does this user have a password?" flag, so we
 * inspect `user.app_metadata.providers` (or `provider`) for the "email"
 * provider as a best-effort signal — it's only used to swap the wording
 * between "Set a password" (Google-only account) and "Change password"
 * (already has one). The underlying API call is the same in both cases.
 */
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { mapAuthError } from "@/lib/authErrors";

// Mirrors Supabase Auth → Email → Minimum password length (set to 8 in the
// dashboard). Keep these in sync — if Supabase rejects a password our client
// said was OK, the user sees a confusing generic error instead of our copy.
const MIN_LENGTH = 8;

export function PasswordCard() {
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = (user?.app_metadata?.providers as string[] | undefined) ?? [];
  const provider = (user?.app_metadata?.provider as string | undefined) ?? "";
  const hasPassword = providers.includes("email") || provider === "email";

  const title = hasPassword ? "Change password" : "Set a password";
  const helper = hasPassword
    ? "Rotate your password whenever you want — your sessions stay signed in."
    : "Add a password so you can sign in without an email code next time.";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = await getSupabase();
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw updateErr;

      toast.success("Password updated", {
        description: "Use it to sign in next time.",
      });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const mapped = mapAuthError(err);
      setError(mapped.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold">Password</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{helper}</p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">{title}</Label>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="••••••••"
            minLength={MIN_LENGTH}
            data-testid="input-new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="••••••••"
            minLength={MIN_LENGTH}
            data-testid="input-confirm-password"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting || !newPassword || !confirmPassword}
          data-testid="button-save-password"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : hasPassword ? (
            "Update password"
          ) : (
            "Set password"
          )}
        </Button>
      </form>
    </Card>
  );
}

export default PasswordCard;
