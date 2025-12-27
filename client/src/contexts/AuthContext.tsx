import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  xp: number;
  level: number;
  citizenLevel: "Newcomer" | "Citizen" | "Verified" | "Elder" | "Founder";
  totalPredictions: number;
  totalVotes: number;
  winRate: number;
}

const MOCK_USER_PROFILE: UserProfile = {
  id: "mock-user-123",
  username: "FameFan42",
  displayName: "Fame Fan",
  avatar: null,
  xp: 2450,
  level: 12,
  citizenLevel: "Citizen",
  totalPredictions: 47,
  totalVotes: 312,
  winRate: 68.5,
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile | null;
  isLoggedIn: boolean;
  signOut: () => Promise<void>;
  mockLogin: () => void;
  mockLogout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMockLoggedIn, setIsMockLoggedIn] = useState(() => {
    const saved = localStorage.getItem("famedex_mock_auth");
    return saved === "true";
  });

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
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (_event, newSession) => {
            if (mounted) {
              setSession(newSession);
              setUser(newSession?.user ?? null);
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
  }, []);

  const signOut = async () => {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
    setIsMockLoggedIn(false);
    localStorage.removeItem("famedex_mock_auth");
  };

  const mockLogin = () => {
    setIsMockLoggedIn(true);
    localStorage.setItem("famedex_mock_auth", "true");
  };

  const mockLogout = () => {
    setIsMockLoggedIn(false);
    localStorage.removeItem("famedex_mock_auth");
  };

  const isLoggedIn = !!user || isMockLoggedIn;
  const profile = isLoggedIn ? MOCK_USER_PROFILE : null;

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      profile,
      isLoggedIn,
      signOut,
      mockLogin,
      mockLogout,
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
