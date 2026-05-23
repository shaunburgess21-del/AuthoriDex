import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import {
  getStoredReferralCode,
  clearStoredReferralCode,
} from "@/lib/referral-capture";

export interface UserProfile {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  avatarSeed?: string | null;
  isPublic: boolean;
  role: "user" | "admin" | "moderator";
  rank: string;
  xpPoints: number;
  predictCredits: number;
  currentStreak: number;
  totalVotes: number;
  totalPredictions: number;
  winRate: number;
  /** AMM open-position visibility (Sprint 1 phase 15.C). Defaults to true. */
  positionsPublic?: boolean;
  // About Me — see migration 0060_badge_system.sql + 0061_profile_extended.sql.
  bio?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  countryOfOrigin?: string | null;
  countryOfResidence?: string | null;
  ethnicity?: string | null;
  profileFieldsPublic?: boolean;
  dobPublic?: boolean;
  genderPublic?: boolean;
  countryPublic?: boolean;
  ethnicityPublic?: boolean;
  socialXHandle?: string | null;
  socialInstagramHandle?: string | null;
  occupationIndustry?: string | null;
  socialHandlesPublic?: boolean;
  occupationPublic?: boolean;
  // Account tab.
  recoveryEmail?: string | null;
  recoveryEmailVerified?: boolean;
  phoneNumber?: string | null;
  lastActiveAt: string | null;
  tosAcceptedAt: string | null;
  // Phase 1 Interest Picker fields. statedInterests is the user's selected
  // category ids (empty until they pick). interestsPromptDismissedAt is set
  // when they skip the picker; the InterestsGate uses both to decide when
  // to show the modal and when to soft re-prompt.
  statedInterests: string[];
  interestsPromptDismissedAt: string | null;
  // Multi-step onboarding (migration 0063). `onboardingStep` is the highest
  // step the user has reached (0..5); `onboardingCompletedAt` is set when
  // they hit the completion screen and is the canonical signal the
  // NewUserGate keys on.
  onboardingStep: number;
  onboardingCompletedAt: string | null;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  /**
   * `true` if the most recent /api/profile/sync created the row (first-ever
   * authenticated session). `false` for returning users. `null` until the
   * first sync resolves — the verify screen waits on this to decide whether
   * to send the user to /login/welcome or straight home.
   */
  profileJustCreated: boolean | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function clearLocalVoteCache() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sentiment-vote-")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileJustCreated, setProfileJustCreated] = useState<boolean | null>(null);
  /** Tracks the last known auth user id so we only bust leaderboard caches on real transitions. */
  const sessionUserIdRef = useRef<string | null>(null);

  const syncProfile = useCallback(async (accessToken: string, retries = 3) => {
    try {
      setProfileLoading(true);

      let lastError: string | null = null;

      // Read the persisted referral code (if any). Only forwarded
      // on the create-profile path server-side, but we always send
      // it — server is the right place to no-op when the profile
      // already exists or the code is invalid.
      const referralCode = getStoredReferralCode();

      for (let attempt = 0; attempt < retries; attempt++) {
        const syncResponse = await fetch("/api/profile/sync", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: referralCode ? JSON.stringify({ referralCode }) : undefined,
        });

        if (syncResponse.ok) {
          const data = await syncResponse.json();
          // First-time signups consume the code. Returning users
          // (created === false) leave the stash alone — it only
          // ever fires once, and the server ignores it for them.
          if (data?.created && referralCode) {
            clearStoredReferralCode();
          }
          // Tolerate the legacy bare-profile response shape during the deploy
          // window when an old client sees a new server, or vice versa.
          const profileData = (data && typeof data === "object" && "profile" in data
            ? (data as { profile: UserProfile }).profile
            : data) as UserProfile;
          const created = Boolean(
            data && typeof data === "object" && "created" in data
              ? (data as { created: boolean }).created
              : false,
          );
          setProfile(profileData);
          setProfileJustCreated(created);
          return;
        }

        lastError = await syncResponse.text();

        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }

      console.error("[AuthContext] Profile sync failed after retries:", lastError);
    } catch (error) {
      console.error("Error syncing profile:", error);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const fetchProfile = useCallback(async (accessToken: string) => {
    try {
      setProfileLoading(true);

      const response = await fetch("/api/profile/me", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const profileData = await response.json();
        setProfile(profileData);
        // Returning users on a refresh: the row already exists, so the verify
        // page won't send anyone to /login/welcome. Mark as not-created.
        setProfileJustCreated(false);
      } else if (response.status === 404) {
        await syncProfile(accessToken);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setProfileLoading(false);
    }
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    if (session?.access_token) {
      await fetchProfile(session.access_token);
    }
  }, [session?.access_token, fetchProfile]);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const supabase = await getSupabase();

        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (mounted) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          sessionUserIdRef.current = currentSession?.user?.id ?? null;
          setLoading(false);

          if (currentSession?.access_token) {
            await fetchProfile(currentSession.access_token);
          }
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, newSession) => {
            if (!mounted) return;
            const prevUserId = sessionUserIdRef.current;
            const newUserId = newSession?.user?.id ?? null;

            setSession(newSession);
            setUser(newSession?.user ?? null);
            sessionUserIdRef.current = newUserId;

            if (newSession?.access_token && _event === "SIGNED_IN") {
              // Supabase may emit SIGNED_IN when restoring an existing session or
              // refocusing a tab. Only invalidate when the authenticated user actually
              // changes so the home leaderboard does not flash a second full-page load.
              if (newUserId && newUserId !== prevUserId) {
                queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
                queryClient.invalidateQueries({ queryKey: ["/api/celebrity"] });
              }
              await syncProfile(newSession.access_token);
            } else if (!newSession) {
              clearLocalVoteCache();
              queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
              queryClient.invalidateQueries({ queryKey: ["/api/celebrity"] });
              setProfile(null);
              setProfileJustCreated(null);
            }
          }
        );

        return () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        console.error("Auth initialization error:", error);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, [fetchProfile, syncProfile]);

  const signOut = async () => {
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearLocalVoteCache();
      sessionUserIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/celebrity"] });
      setProfile(null);
      setProfileJustCreated(null);
    } catch (err) {
      console.error("Sign-out failed:", err);
      toast.error("Sign-out failed", {
        description: "Please try again in a moment.",
      });
      throw err;
    }
  };

  const isLoggedIn = !!user;
  const isAdmin = profile?.role === "admin";

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      profile,
      profileLoading,
      profileJustCreated,
      isLoggedIn,
      isAdmin,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
