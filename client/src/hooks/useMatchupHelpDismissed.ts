import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  isMatchupHelpDismissed,
  readLocalMatchupHelpDismissed,
  setLocalMatchupHelpDismissed,
  MATCHUP_HELP_EVENT,
} from "@/lib/matchup-help-dismiss";

const anonDismissSyncedUserIds = new Set<string>();

async function patchMatchupHelpDismissed(accessToken: string): Promise<string | null> {
  const response = await fetch("/api/profile/me/matchup-help-dismissed", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { matchupHelpDismissedAt?: string | null };
  return data.matchupHelpDismissedAt ?? null;
}

export function useMatchupHelpDismissed() {
  const { user, session, profile, profileLoading, refreshProfile } = useAuth();
  const isLoggedIn = !!user;
  const [localDismissed, setLocalDismissed] = useState(readLocalMatchupHelpDismissed);
  const profileLoaded = isLoggedIn && !profileLoading && profile !== null;

  const dismissed = isMatchupHelpDismissed({
    profileDismissedAt: profile?.matchupHelpDismissedAt,
    localDismissed,
    isLoggedIn,
    profileLoaded,
  });

  useEffect(() => {
    const syncFromStorage = () => setLocalDismissed(readLocalMatchupHelpDismissed());

    window.addEventListener(MATCHUP_HELP_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener(MATCHUP_HELP_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  // Migrate anonymous localStorage dismiss to profile after sign-in.
  useEffect(() => {
    if (!isLoggedIn || !profileLoaded || !user?.id) return;
    if (anonDismissSyncedUserIds.has(user.id)) return;
    if (!localDismissed || profile.matchupHelpDismissedAt) return;
    if (!session?.access_token) return;

    anonDismissSyncedUserIds.add(user.id);
    void patchMatchupHelpDismissed(session.access_token).then((ts) => {
      if (ts) void refreshProfile();
    });
  }, [
    isLoggedIn,
    profileLoaded,
    user?.id,
    localDismissed,
    profile?.matchupHelpDismissedAt,
    session?.access_token,
    refreshProfile,
  ]);

  const dismissHelp = useCallback(() => {
    setLocalDismissed(true);
    setLocalMatchupHelpDismissed();

    if (isLoggedIn && session?.access_token) {
      void patchMatchupHelpDismissed(session.access_token).then((ts) => {
        if (ts) void refreshProfile();
      });
    }
  }, [isLoggedIn, session?.access_token, refreshProfile]);

  return { dismissed, dismissHelp };
}
