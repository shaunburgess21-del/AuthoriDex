/**
 * VoxDex sign-in / sign-up entry point.
 * - Signin: email + password, with an "email code instead" fallback link.
 * - Signup: email + password (required, ≥6 chars). Verification happens at /login/verify.
 * - Google OAuth uses the existing snapshot/return mechanism in `authReturn.ts`.
 * The `emailAuthInProgressRef` blocks the OAuth-return effect from racing any
 * email-flow submit while we navigate to the verify page.
 */
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import {
  redirectAfterLogin,
  stashAuthReturnSnapshot,
  hasPendingAuthReturnSnapshot,
  clearStaleAuthReturnSnapshotOnDirectVisit,
  markAuthNavIntent,
} from "@/lib/authReturn";
import { setPending } from "@/lib/pendingAuth";
import { mapAuthError } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Chrome } from "lucide-react";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import type { AuthReason } from "@/lib/authReturn";
import { SignupReasonModal } from "@/components/auth/SignupReasonModal";

function parseReason(value: string | null): AuthReason | null {
  return value === "vote_limit_reached" || value === "predict_signup"
    ? value
    : null;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { user, profile, loading: authLoading, profileLoading } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const [isLogin, setIsLogin] = useState(params.get("mode") !== "signup");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState<AuthReason | null>(
    parseReason(params.get("reason")),
  );
  const [loading, setLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [fieldError, setFieldError] = useState<{
    field: "email" | "password" | "form";
    message: string;
    code?: string;
  } | null>(null);
  /** Prevents OAuth redirect effect from consuming snapshot while any email-flow submit is in flight. */
  const emailAuthInProgressRef = useRef(false);
  /** Refocus target after SignupReasonModal dismissal. */
  const emailInputRef = useRef<HTMLInputElement>(null);

  // On direct /login visit (bookmark, refresh, external link) drop any stale snapshot so
  // a successful sign-in doesn't kick the user to an unrelated prior-session page.
  // navigateToLogin() and the Google OAuth handler both call markAuthNavIntent() before
  // redirecting, so intentional auth flows survive this cleanup.
  useEffect(() => {
    clearStaleAuthReturnSnapshotOnDirectVisit();
  }, []);

  // Google OAuth returns here with a session. Un-onboarded users go straight
  // to welcome — never via / (avoids a flash of home before NewUserGate).
  useEffect(() => {
    if (authLoading || profileLoading || !user) return;
    if (window.location.pathname !== "/login") return;
    if (emailAuthInProgressRef.current) return;
    if (profile && !profile.onboardingCompletedAt) {
      setLocation("/login/welcome", { replace: true });
      return;
    }
    if (!hasPendingAuthReturnSnapshot()) return;
    redirectAfterLogin(setLocation);
  }, [user, profile, authLoading, profileLoading, setLocation]);

  // Keep mode in sync with the querystring (mainly for the Edit-email return from /login/verify).
  useEffect(() => {
    const handler = () => {
      const next = new URLSearchParams(window.location.search);
      setIsLogin(next.get("mode") !== "signup");
      const qsEmail = next.get("email");
      if (qsEmail) setEmail(qsEmail);
      setReason(parseReason(next.get("reason")));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const sendOtp = async (targetEmail: string): Promise<boolean> => {
    setOtpSending(true);
    emailAuthInProgressRef.current = true;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setPending(targetEmail, "otp");
      toast("Check your email", {
        description: `We sent a 6-digit code to ${targetEmail}.`,
      });
      setLocation("/login/verify");
      return true;
    } catch (err) {
      const mapped = mapAuthError(err);
      toast.error(mapped.message, { description: mapped.suggestion });
      return false;
    } finally {
      setOtpSending(false);
      emailAuthInProgressRef.current = false;
    }
  };

  const handleEmailCodeFallback = async () => {
    if (!email) {
      setFieldError({ field: "email", message: "Enter your email above first." });
      return;
    }
    setFieldError(null);
    await sendOtp(email);
  };

  const isObfuscatedExistingSignup = (
    signupData: { user?: { identities?: unknown } | null; session?: unknown | null } | null | undefined,
  ): boolean => {
    if (signupData?.session) return false;
    const identities = signupData?.user?.identities;
    return Array.isArray(identities) && identities.length === 0;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setLoading(true);
    emailAuthInProgressRef.current = true;

    try {
      const supabase = await getSupabase();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          const mapped = mapAuthError(error);

          // email_not_confirmed → silently resend a signup OTP and continue to /login/verify.
          if (mapped.code === "email_not_confirmed") {
            try {
              await supabase.auth.resend({ type: "signup", email });
              setPending(email, "password_signup");
              toast("Verify your email to continue", {
                description: "We just sent you a fresh 6-digit code.",
              });
              setLocation("/login/verify");
              return;
            } catch (resendErr) {
              const m = mapAuthError(resendErr);
              toast.error(m.message, { description: m.suggestion });
              return;
            }
          }

          // invalid_credentials → inline error with email-code link suggestion.
          if (mapped.code === "invalid_credentials") {
            setFieldError({
              field: "password",
              message: mapped.message,
              code: mapped.code,
            });
            return;
          }

          throw error;
        }

        toast.success("Welcome back!", { description: "You've successfully signed in." });
        redirectAfterLogin(setLocation);
      } else {
        // Signup path — password required.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          const mapped = mapAuthError(error);
          if (mapped.code === "user_already_registered") {
            setFieldError({
              field: "form",
              message: mapped.message,
              code: mapped.code,
            });
            return;
          }
          throw error;
        }

        // Supabase anti-enumeration behavior: duplicate signups can return a
        // user object with empty identities and no error.
        if (isObfuscatedExistingSignup(data)) {
          setFieldError({
            field: "form",
            message: "This email is already registered. Sign in to continue.",
            code: "user_already_registered",
          });
          return;
        }

        // Supabase will return user + null session when email confirmation is on.
        // Either way, we route to the verify page; AuthContext will pick up the session
        // when the user submits the OTP.
        if (data?.user || data?.session) {
          setPending(email, "password_signup");
          toast("Account created", {
            description: `We sent a 6-digit code to ${email}.`,
          });
          setLocation("/login/verify");
          return;
        }

        // Defensive fallback: some anti-enumeration configurations can return
        // no explicit error and no new user/session on duplicate signup.
        setFieldError({
          field: "form",
          message: "This email is already registered. Sign in to continue.",
          code: "user_already_registered",
        });
        return;
      }
    } catch (error: unknown) {
      const mapped = mapAuthError(error);
      toast.error(mapped.message, { description: mapped.suggestion });
    } finally {
      emailAuthInProgressRef.current = false;
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      // Snapshot was written when the user opened /login via navigateToLogin; only stash if missing
      // (e.g. bookmarked /login) so we do not overwrite a good stash with "/".
      if (!hasPendingAuthReturnSnapshot()) {
        stashAuthReturnSnapshot();
      }
      // Full-page OAuth redirect remounts LoginPage on return; mark the intent so the
      // direct-visit cleanup doesn't discard the fresh snapshot.
      markAuthNavIntent();
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Allowlist this URL in Supabase Dashboard → Authentication → URL Configuration.
          redirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) throw error;
    } catch (error: unknown) {
      const mapped = mapAuthError(error);
      toast.error("Google sign-in failed", { description: mapped.message });
    }
  };

  const dismissReason = () => {
    // Strip ?reason= but preserve mode/email/etc. so the URL stays a
    // valid deep link to the LoginPage and a refresh doesn't re-show
    // the modal.
    const next = new URLSearchParams(window.location.search);
    next.delete("reason");
    const q = next.toString();
    const newUrl =
      window.location.pathname + (q ? `?${q}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
    setReason(null);
    // Defer focus to next tick so the modal unmounts and Radix
    // releases its focus trap before we move focus to the email input.
    setTimeout(() => emailInputRef.current?.focus(), 0);
  };

  const handleContinueToSignUp = () => {
    setIsLogin(false);
    dismissReason();
  };

  const handleSwitchToSignIn = () => {
    setIsLogin(true);
    dismissReason();
  };

  const submitDisabled = loading || otpSending;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <VoxDexLogo size={48} />
            <span className="font-serif font-bold text-3xl">VoxDex</span>
          </div>
          <p className="text-muted-foreground">The global trend index for people and events shaping the world.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isLogin ? "Welcome back" : "Create your account"}</CardTitle>
            <CardDescription>
              {isLogin
                ? "Sign in to vote, predict, and track your favorites."
                : "Make predictions, vote on what matters, build your track record."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleGoogleAuth}
              disabled={submitDisabled}
              data-testid="button-google-signin"
            >
              <Chrome className="h-5 w-5" />
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  ref={emailInputRef}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldError?.field === "email") setFieldError(null);
                  }}
                  required
                  data-testid="input-email"
                />
                {fieldError?.field === "email" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fieldError.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldError?.field === "password") setFieldError(null);
                  }}
                  required
                  minLength={8}
                  data-testid="input-password"
                />
                {fieldError?.field === "password" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fieldError.message}{" "}
                    {fieldError.code === "invalid_credentials" ? (
                      <button
                        type="button"
                        onClick={handleEmailCodeFallback}
                        className="underline underline-offset-2 hover:text-foreground"
                        data-testid="link-inline-email-code"
                      >
                        Use an email code instead.
                      </button>
                    ) : null}
                  </p>
                ) : isLogin ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleEmailCodeFallback}
                      disabled={otpSending}
                      className="text-xs text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-60"
                      data-testid="button-use-email-code"
                    >
                      Sign in with email code instead
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                )}
              </div>

              {fieldError?.field === "form" ? (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError.message}{" "}
                  {fieldError.code === "user_already_registered" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsLogin(true);
                        setFieldError(null);
                      }}
                      className="underline underline-offset-2 hover:text-foreground"
                      data-testid="link-signin-instead"
                    >
                      Sign in instead.
                    </button>
                  ) : null}
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={submitDisabled}
                data-testid="button-email-submit"
              >
                <Mail className="h-4 w-4" />
                {loading ? "Please wait..." : isLogin ? "Sign in" : "Create account"}
              </Button>

              {!isLogin ? (
                <p className="mt-3 text-center text-xs text-muted-foreground leading-snug">
                  By continuing, you agree to our{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-foreground"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                  .
                </p>
              ) : null}
            </form>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setFieldError(null);
                }}
                className="text-primary hover:underline"
                data-testid="button-toggle-mode"
              >
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>

            <div className="text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/")}
                data-testid="button-back-home"
              >
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {reason !== null ? (
        <SignupReasonModal
          reason={reason}
          onDismiss={dismissReason}
          onContinueToSignUp={handleContinueToSignUp}
          onSwitchToSignIn={handleSwitchToSignIn}
        />
      ) : null}
    </div>
  );
}
