export const MATCHUP_HELP_HIDDEN_KEY = "authoridex_matchup_help_hidden";
export const MATCHUP_HELP_EVENT = "authoridex-matchup-help-hidden-changed";

export function readLocalMatchupHelpDismissed(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(MATCHUP_HELP_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLocalMatchupHelpDismissed(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(MATCHUP_HELP_HIDDEN_KEY, "1");
  } catch {
    /* Preference persistence is optional in private browsing. */
  }

  window.dispatchEvent(new CustomEvent(MATCHUP_HELP_EVENT));
}

/** Whether the inactive-card help footer should be hidden. */
export function isMatchupHelpDismissed(opts: {
  profileDismissedAt: string | null | undefined;
  localDismissed: boolean;
  isLoggedIn: boolean;
  profileLoaded: boolean;
}): boolean {
  const { profileDismissedAt, localDismissed, isLoggedIn, profileLoaded } = opts;

  if (localDismissed) return true;
  if (isLoggedIn && profileLoaded && profileDismissedAt) return true;
  return false;
}
