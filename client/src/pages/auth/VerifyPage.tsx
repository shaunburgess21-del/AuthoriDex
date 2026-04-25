/**
 * /login/verify — 6-digit OTP entry shared by both signup confirmation and
 * the OTP-fallback signin path. Reads the pending email + intent from
 * `pendingAuth` (sessionStorage, 10-min TTL). On success the AuthContext
 * picks up the new session and this page routes the user to /login/welcome
 * (first-ever profile) or back to wherever they came from.
 *
 * UX details handled here:
 *   - Auto-submits when 6 digits are entered (no extra Verify click).
 *   - 30s resend cooldown with a live label.
 *   - "Edit email" returns to /login with `?email=...&mode=signup` so the
 *     LoginPage can keep the user's progress without restarting from blank.
 *   - Auto-resends one fresh code if Supabase reports otp_expired.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { VoxDexLogo } from "@/components/VoxDexLogo";

import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import {
  redirectAfterLogin,
  hasPendingAuthReturnSnapshot,
} from "@/lib/authReturn";
import { mapAuthError } from "@/lib/authErrors";
import {
  clearPending,
  getPending,
  setPending,
  type PendingAuth,
} from "@/lib/pendingAuth";

const RESEND_COOLDOWN_S = 30;
const CODE_LENGTH = 6;

export default function VerifyPage() {
  const [, setLocation] = useLocation();
  const { user, profileJustCreated, profileLoading } = useAuth();

  const [pending, setPendingState] = useState<PendingAuth | null>(() => getPending());
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_S);
  const [error, setError] = useState<string | null>(null);

  const verifiedRef = useRef(false);
  const autoResubmittedRef = useRef(false);

  // No pending state → kick back to /login. The user landed here directly
  // (refresh or paste-link) without a fresh send.
  useEffect(() => {
    if (!pending) {
      setLocation("/login", { replace: true });
    }
  }, [pending, setLocation]);

  // Resend cooldown ticker. Initialized at RESEND_COOLDOWN_S and decremented
  // every second; the resend button reads `resendIn === 0` to enable.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => {
      setResendIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  // Once auth + profile have settled, route the user. Wait for both `user`
  // AND a non-null `profileJustCreated` so we don't bounce a brand-new user
  // past the welcome screen because the sync hadn't completed yet.
  useEffect(() => {
    if (!verifiedRef.current) return;
    if (!user) return;
    if (profileJustCreated === null) return;
    if (profileLoading) return;

    if (profileJustCreated) {
      setLocation("/login/welcome", { replace: true });
    } else if (hasPendingAuthReturnSnapshot()) {
      redirectAfterLogin(setLocation);
    } else {
      setLocation("/", { replace: true });
    }
  }, [user, profileJustCreated, profileLoading, setLocation]);

  const handleResend = useCallback(
    async (auto = false): Promise<boolean> => {
      if (!pending) return false;
      setResending(true);
      setError(null);
      try {
        const supabase = await getSupabase();
        if (pending.intent === "password_signup") {
          const { error: resendErr } = await supabase.auth.resend({
            type: "signup",
            email: pending.email,
          });
          if (resendErr) throw resendErr;
        } else {
          const { error: otpErr } = await supabase.auth.signInWithOtp({
            email: pending.email,
            options: { shouldCreateUser: pending.intent === "otp" },
          });
          if (otpErr) throw otpErr;
        }
        setPending(pending.email, pending.intent);
        setPendingState(getPending());
        setResendIn(RESEND_COOLDOWN_S);
        if (!auto) {
          toast("New code sent", {
            description: `We just sent another 6-digit code to ${pending.email}.`,
          });
        } else {
          toast("Sent a fresh code", {
            description: "The previous one expired. Try the new code.",
          });
        }
        return true;
      } catch (err) {
        const mapped = mapAuthError(err);
        toast.error(mapped.message, { description: mapped.suggestion });
        return false;
      } finally {
        setResending(false);
      }
    },
    [pending],
  );

  const verify = useCallback(
    async (token: string) => {
      if (!pending) return;
      if (verifying || verifiedRef.current) return;

      setVerifying(true);
      setError(null);

      try {
        const supabase = await getSupabase();
        const { error: verifyErr } =
          pending.intent === "password_signup"
            ? await supabase.auth.verifyOtp({
                email: pending.email,
                token,
                type: "signup",
              })
            : await supabase.auth.verifyOtp({
                email: pending.email,
                token,
                type: "email",
              });

        if (verifyErr) {
          const mapped = mapAuthError(verifyErr);

          if (mapped.code === "otp_expired" && !autoResubmittedRef.current) {
            autoResubmittedRef.current = true;
            setError(mapped.message);
            setCode("");
            // Slight delay so the user sees the error before the resend toast.
            setTimeout(() => {
              void handleResend(true);
            }, 1000);
            return;
          }

          setError(mapped.message);
          setCode("");
          return;
        }

        verifiedRef.current = true;
        clearPending();
        // The post-verify route effect handles navigation as soon as
        // AuthContext has the new session + profile.
      } catch (err) {
        const mapped = mapAuthError(err);
        setError(mapped.message);
        setCode("");
      } finally {
        setVerifying(false);
      }
    },
    [pending, verifying, handleResend],
  );

  const handleChange = (next: string) => {
    // Sanitize aggressively so paste-from-email "Just works". Email clients
    // often render the code with a middle space ("687 441") for readability;
    // when the user copies the displayed value the space comes along and would
    // otherwise produce a 7-character string that fails verification.
    const sanitized = next.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(sanitized);
    if (error) setError(null);
    if (sanitized.length === CODE_LENGTH && !verifying && !verifiedRef.current) {
      void verify(sanitized);
    }
  };

  const handleEditEmail = () => {
    if (!pending) {
      setLocation("/login", { replace: true });
      return;
    }
    const qs = new URLSearchParams({ email: pending.email });
    if (pending.intent === "password_signup") qs.set("mode", "signup");
    clearPending();
    setLocation(`/login?${qs.toString()}`);
  };

  const cooldownLabel = useMemo(() => {
    if (resending) return "Sending…";
    if (resendIn > 0) return `Resend in ${resendIn}s`;
    return "Resend code";
  }, [resending, resendIn]);

  if (!pending) {
    return null;
  }

  const headline =
    pending.intent === "password_signup" ? "Confirm your email" : "Enter your code";
  const subhead =
    pending.intent === "password_signup"
      ? "We sent a 6-digit code so we know it's really you."
      : "We sent a 6-digit code to sign you in.";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <VoxDexLogo size={48} />
            <span className="font-serif font-bold text-3xl">VoxDex</span>
          </div>
          <p className="text-muted-foreground">Just one more step</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{headline}</CardTitle>
            <CardDescription>
              {subhead}{" "}
              <span className="font-medium text-foreground" data-testid="text-pending-email">
                {pending.email}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center gap-3">
              <InputOTP
                maxLength={CODE_LENGTH}
                value={code}
                onChange={handleChange}
                disabled={verifying}
                data-testid="input-otp-code"
              >
                <InputOTPGroup>
                  {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} className="h-12 w-12 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>

              {verifying ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </p>
              ) : error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The code expires in 10 minutes.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => void handleResend(false)}
                disabled={resendIn > 0 || resending}
                data-testid="button-resend-otp"
              >
                <Mail className="h-4 w-4" />
                {cooldownLabel}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full gap-2"
                onClick={handleEditEmail}
                data-testid="button-edit-email"
              >
                <ArrowLeft className="h-4 w-4" />
                Edit email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
