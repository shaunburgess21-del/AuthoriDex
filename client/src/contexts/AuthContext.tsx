import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import {
  getStoredReferralCode,
  clearStoredReferralCode,
} from "@/lib/referral-capture";
import {
  authSessionBlockActive,
  clearPersonalizedVoteStorage,
  clearPersistedAuthStorage,
  clearSignedOutSessionStorage,
  holdAuthSessionBlock,
  holdAuthWriteBlock,
  shouldApplyProfileResponse,
  shouldDiscardAuthRestore,
  shouldDropQueryOnSignOut,
  stripAuthCallbackFromHref,
  tearDownAuthSession,
} from "@/lib/authSession";

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
  /** Live count of authored comments + replies (excludes soft-deleted). Set by /api/profile/me. */
  totalComments?: number;
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
  // Per-tier profile visual unlocks (Phase 5). Banner = Maven (Tier 6+),
  // theme = VoxMax Legend (Tier 8). Rendered conditionally on current tier.
  profileBannerUrl?: string | null;
  profileTheme?: string | null;
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
  /** Set when the user dismisses inactive VersusCard help (X). */
  matchupHelpDismissedAt?: string | null;
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

/**
 * Feed queries whose ordering is personalised server-side (interest /
 * behavioural blend). On a hard refresh these mount and fetch before the
 * Supabase session is restored (the client is created via an async
 * /api/config/supabase round-trip), so the first fetch can land without an
 * Authorization header and receive the anonymous cold-start order. That
 * result is then cached (staleTime) and never refetched, so a logged-in
 * user is stuck with the anonymous order. Invalidating these the moment a
 * session is available forces a refetch with the auth header.
 */
const PERSONALISED_FEED_QUERY_KEYS = [
  ["/api/matchups"],
  ["/api/trending-polls"],
  ["/api/opinion-polls"],
  ["/api/open-markets"],
] as const;

function invalidatePersonalisedFeeds() {
  for (const queryKey of PERSONALISED_FEED_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/**
 * Responses that embed the caller's own ballot. Drop them on an account
 * change so a new login cannot paint the previous viewer's "already voted"
 * state (the query keys are not scoped by user id).
 */
const PERSONAL_VOTE_QUERY_KEYS = [
  ["/api/trending-polls"],
  ["/api/opinion-polls"],
  ["/api/matchups"],
  ["/api/matchups/user-votes"],
  ["/api/vote/overall-ratings"],
  ["/api/me/induction-votes"],
  ["/api/me/curate-voted-person-ids"],
  ["/api/celebrity"],
] as const;

function dropPersonalizedVoteQueries() {
  for (const queryKey of PERSONAL_VOTE_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [...queryKey] });
  }
}

function clearLocalVoteCache() {
  try {
    clearPersonalizedVoteStorage(window.localStorage);
  } catch {
    /* ignore */
  }
}

function dropSignedOutQueries() {
  queryClient.removeQueries({
    predicate: (query) => shouldDropQueryOnSignOut(query.queryKey),
  });
  queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
  invalidatePersonalisedFeeds();
}

/** UI, vote cache, and auth-flow leftovers. Does not delete the Supabase session key. */
function markSignedOutLocally(profileEpoch: { current: number }, sessionUserId: { current: string | null }, apply: () => void) {
  profileEpoch.current += 1;
  holdAuthWriteBlock();
  sessionUserId.current = null;
  apply();
  try {
    clearPersonalizedVoteStorage(window.localStorage);
    clearSignedOutSessionStorage(window.sessionStorage);
    const next = stripAuthCallbackFromHref(window.location.href);
    if (next) window.history.replaceState(window.history.state, "", next);
  } catch {
    /* private mode */
  }
  dropSignedOutQueries();
}

/** After the refresh token has been revoked, hide and delete the persisted session. */
function sealSignedOutSession() {
  holdAuthSessionBlock();
  try {
    clearPersistedAuthStorage(window.localStorage);
  } catch {
    /* private mode */
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
  /** Bumped on logout so an in-flight /api/profile/me response cannot restore the account. */
  const profileEpoch = useRef(0);

  const syncProfile = useCallback(async (accessToken: string, retries = 3) => {
    const epoch = profileEpoch.current;
    if (!shouldApplyProfileResponse(epoch, epoch)) return;
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
          if (!shouldApplyProfileResponse(epoch, profileEpoch.current)) return;
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
      if (shouldApplyProfileResponse(epoch, profileEpoch.current) || authSessionBlockActive()) {
        setProfileLoading(false);
      }
    }
  }, []);

  const fetchProfile = useCallback(async (accessToken: string) => {
    const epoch = profileEpoch.current;
    if (!shouldApplyProfileResponse(epoch, epoch)) return;
    try {
      setProfileLoading(true);

      const response = await fetch("/api/profile/me", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      });

      if (!shouldApplyProfileResponse(epoch, profileEpoch.current)) return;

      if (response.ok) {
        const profileData = await response.json();
        if (!shouldApplyProfileResponse(epoch, profileEpoch.current)) return;
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
      if (shouldApplyProfileResponse(epoch, profileEpoch.current) || authSessionBlockActive()) {
        setProfileLoading(false);
      }
    }
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    if (session?.access_token) {
      await fetchProfile(session.access_token);
    }
  }, [session?.access_token, fetchProfile]);

  const applySignedOutState = useCallback(() => {
    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileJustCreated(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    async function initialize() {
      try {
        const supabase = await getSupabase();
        if (!mounted) return;

        // Subscribe before yielding again. Logout during the profile fetch
        // used to run with no listener, so SIGNED_OUT never cleared `user`
        // and the late /api/profile/me response painted the account again.
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!mounted) return;

        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          async (event, newSession) => {
            if (!mounted) return;

            if (!newSession) {
              // Startup with no session must not wipe anonymous ballot keys.
              // A real sign-out has either started the write block or still
              // has a user id on this tab (including a broadcast from another tab).
              const endedSession =
                authSessionBlockActive() || sessionUserIdRef.current !== null;
              if (endedSession) {
                markSignedOutLocally(profileEpoch, sessionUserIdRef, applySignedOutState);
                sealSignedOutSession();
              } else {
                applySignedOutState();
              }
              return;
            }

            if (shouldDiscardAuthRestore(true)) {
              // Refresh or replayed OAuth finished after logout. Do not seal
              // here — the click handler still has to read the refresh token
              // and revoke it. The write block already drops the save.
              applySignedOutState();
              return;
            }

            const prevUserId = sessionUserIdRef.current;
            const newUserId = newSession.user?.id ?? null;
            const switchedAccount = newUserId !== prevUserId;
            // Drop device-level rating keys before React paints the new
            // identity. Otherwise Overall Rating cards adopt the previous
            // viewer's localStorage vote for this session.
            if (switchedAccount) clearLocalVoteCache();

            setSession(newSession);
            setUser(newSession.user ?? null);
            sessionUserIdRef.current = newUserId;

            if (newSession.access_token && event === "SIGNED_IN") {
              // Supabase may emit SIGNED_IN when restoring an existing session or
              // refocusing a tab. Only invalidate when the authenticated user actually
              // changes so the home leaderboard does not flash a second full-page load.
              // Profile sync runs first: a brand-new account migrates this browser's
              // anon_<fdx_sid> ballots inside that call, and the vote caches must
              // refetch after that reassignment rather than before it.
              await syncProfile(newSession.access_token);
              if (!mounted || shouldDiscardAuthRestore(true)) {
                applySignedOutState();
                return;
              }
              if (switchedAccount) {
                dropPersonalizedVoteQueries();
                queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
                queryClient.invalidateQueries({ queryKey: ["/api/celebrity"] });
                // Personalised feeds must re-rank for the newly signed-in user.
                invalidatePersonalisedFeeds();
              }
            }
          }
        );
        subscription = sub;
        if (!mounted) {
          sub.unsubscribe();
          return;
        }

        // getSession can resolve after a logout that started on a remount.
        // Applying it would put the account back.
        if (authSessionBlockActive()) {
          setLoading(false);
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        sessionUserIdRef.current = currentSession?.user?.id ?? null;
        setLoading(false);

        if (currentSession?.access_token) {
          void fetchProfile(currentSession.access_token);
          // Session was restored after a refresh; any feed query that
          // already fetched anonymously (before the session resolved)
          // must refetch with the auth header to get personalised order.
          invalidatePersonalisedFeeds();
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [applySignedOutState, fetchProfile, syncProfile]);

  const signOut = async () => {
    // Header drops immediately. The write block is up before the first await
    // so a refresh that resolves while revoke is in flight cannot save.
    markSignedOutLocally(profileEpoch, sessionUserIdRef, applySignedOutState);
    try {
      const supabase = await getSupabase();
      await tearDownAuthSession(supabase.auth, window.localStorage);
    } catch (err) {
      console.error("Sign-out failed:", err);
    } finally {
      sealSignedOutSession();
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
