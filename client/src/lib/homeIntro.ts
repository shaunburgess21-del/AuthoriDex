/** Remembered in localStorage. First visit is the full card; later visits are one line until dismissed. */
export const HOME_INTRO_STORAGE_KEY = "voxdex_home_intro";

export const HOME_INTRO_TAGLINE = "See who's rising — then weigh in.";

export const HOME_INTRO_STEPS = [
  { title: "Vote", detail: "Rate people from 1 to 5" },
  { title: "Predict", detail: "Call the next move" },
  { title: "Climb", detail: "Earn XP as you go" },
] as const;

export const HOME_INTRO_COMPACT = "Vote, predict, and climb the live index.";

export type HomeIntroMode = "full" | "compact" | "hidden";

export function homeIntroModeFromStored(raw: string | null): HomeIntroMode {
  if (raw === "hidden") return "hidden";
  if (raw === "seen" || raw === "compact") return "compact";
  return "full";
}

/** What to persist after the full card has been shown once. Never overwrites a dismissal. */
export function homeIntroStoredAfterSeen(current: string | null): string {
  if (current === "hidden") return "hidden";
  return "seen";
}
