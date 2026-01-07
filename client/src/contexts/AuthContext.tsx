import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
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
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
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

  // Sync profile with backend - creates profile if doesn't exist
  const syncProfile = useCallback(async (accessToken: string) => {
    try {
      setProfileLoading(true);
      
      // First, sync the profile (creates it if needed)
      const syncResponse = await fetch("/api/profile/sync", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      
      if (!syncResponse.ok) {
        console.error("Failed to sync profile:", await syncResponse.text());
        return;
      }
      
      const profileData = await syncResponse.json();
      setProfile(profileData);
    } catch (error) {
      console.error("Error syncing profile:", error);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Fetch profile from backend
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
      } else if (response.status === 404) {
        // Profile doesn't exist, sync it
        await syncProfile(accessToken);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setProfileLoading(false);
    }
  }, [syncProfile]);

  // Refresh profile manually
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
          
          // Fetch profile if logged in
          if (currentSession?.access_token) {
            await fetchProfile(currentSession.access_token);
          }
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, newSession) => {
            if (mounted) {
              setSession(newSession);
              setUser(newSession?.user ?? null);
              
              // Sync profile on login
              if (newSession?.access_token && _event === "SIGNED_IN") {
                await syncProfile(newSession.access_token);
              } else if (!newSession) {
                setProfile(null);
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
    const supabase = await getSupabase();
    await supabase.auth.signOut();
    setProfile(null);
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
