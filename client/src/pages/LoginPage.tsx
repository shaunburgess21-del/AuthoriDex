import { useState } from "react";
import { useLocation } from "wouter";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, Chrome } from "lucide-react";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const [isLogin, setIsLogin] = useState(params.get("mode") !== "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = await getSupabase();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: "Welcome back!",
          description: "You've successfully signed in.",
        });
        setLocation("/me");
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
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/me`,
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
            <AuthoriDexLogo size={48} />
            <span className="font-serif font-bold text-3xl">AuthoriDex</span>
          </div>
          <p className="text-muted-foreground">Track fame, vote sentiment, discover trends</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isLogin ? "Welcome Back" : "Create Account"}</CardTitle>
            <CardDescription>
              {isLogin
                ? "Sign in to access your profile and save votes"
                : "Join AuthoriDex to track your favorite celebrities"}
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
