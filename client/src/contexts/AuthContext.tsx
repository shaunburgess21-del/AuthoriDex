import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";

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
  lastActiveAt: string | null;
  tosAcceptedAt: string | null;
  // Phase 1 Interest Picker fields. statedInterests is the user's selected
  // category ids (empty until they pick). interestsPromptDismissedAt is set
  // when they skip the picker; the InterestsGate uses both to decide when
  // to show the modal and when to soft re-prompt.
  statedInterests: string[];
  interestsPromptDismissedAt: string | null;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileJustCreated, setProfileJustCreated] = useState<boolean | null>(null);

  const syncProfile = useCallback(async (accessToken: string, retries = 3) => {
    try {
      setProfileLoading(true);

      let lastError: string | null = null;

      for (let attempt = 0; attempt < retries; attempt++) {
        const syncResponse = await fetch("/api/profile/sync", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

        if (syncResponse.ok) {
          const data = await syncResponse.json();
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
          setLoading(false);

          if (currentSession?.access_token) {
            await fetchProfile(currentSession.access_token);
          }
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, newSession) => {
            if (mounted) {
              setSession(newSession);
              setUser(newSession?.user ?? null);

              if (newSession?.access_token && _event === "SIGNED_IN") {
                await syncProfile(newSession.access_token);
              } else if (!newSession) {
                setProfile(null);
                setProfileJustCreated(null);
              }
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
