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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, Chrome } from "lucide-react";
import { VoxDexLogo } from "@/components/VoxDexLogo";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const [isLogin, setIsLogin] = useState(params.get("mode") !== "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  /** Prevents OAuth redirect effect from consuming snapshot while email sign-in handler runs. */
  const emailAuthInProgressRef = useRef(false);

  // On direct /login visit (bookmark, refresh, external link) drop any stale snapshot so
  // a successful sign-in doesn't kick the user to an unrelated prior-session page.
  // navigateToLogin() and the Google OAuth handler both call markAuthNavIntent() before
  // redirecting, so intentional auth flows survive this cleanup.
  useEffect(() => {
    clearStaleAuthReturnSnapshotOnDirectVisit();
  }, []);

  // Google OAuth returns here with a session; redirect using the snapshot stashed before OAuth.
  useEffect(() => {
    if (authLoading || !user) return;
    if (window.location.pathname !== "/login") return;
    if (emailAuthInProgressRef.current) return;
    if (!hasPendingAuthReturnSnapshot()) return;
    redirectAfterLogin(setLocation);
  }, [user, authLoading, setLocation]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = await getSupabase();

      if (isLogin) {
        emailAuthInProgressRef.current = true;
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: "Welcome back!",
          description: "You've successfully signed in.",
        });
        redirectAfterLogin(setLocation);
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: "Account created!",
          description: "Please check your email to verify your account.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Authentication failed",
        description: error.message || "An error occurred during authentication.",
        variant: "destructive",
      });
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
    } catch (error: any) {
      toast({
        title: "Google sign-in failed",
        description: error.message || "An error occurred during Google sign-in.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <VoxDexLogo size={48} />
            <span className="font-serif font-bold text-3xl">VoxDex</span>
          </div>
          <p className="text-muted-foreground">Track fame, vote sentiment, discover trends</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isLogin ? "Welcome Back" : "Create Account"}</CardTitle>
            <CardDescription>
              {isLogin
                ? "Sign in to access your profile and save votes"
                : "Join VoxDex to track your favorite celebrities"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleGoogleAuth}
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

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="input-email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  data-testid="input-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={loading}
                data-testid="button-email-submit"
              >
                <Mail className="h-4 w-4" />
                {loading ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
              </Button>
            </form>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
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
    </div>
  );
}
