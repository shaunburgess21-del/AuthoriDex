/**
 * Same flag the rating cards and leaderboard write after a vote lands.
 * Do not rename — existing browsers already store it.
 */
export const HAS_EVER_VOTED_STORAGE_KEY = "authoridex-has-ever-voted";

export const HOW_IT_WORKS_TOUR_STORAGE_KEY = "voxdex_seen_how_it_works";

const MS_PER_DAY = 86_400_000;

export function readHasEverVoted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HAS_EVER_VOTED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The How It Works pill stays hidden after the tour is dismissed
 * (or finished) and after the visitor's first vote. Votes count from
 * either the local ever-voted flag or the signed-in profile total.
 */
export function shouldOfferHowItWorksTour(input: {
  now: number;
  seenRaw: string | null;
  reShowAfterDays: number;
  totalVotes: number;
  hasEverVoted: boolean;
}): boolean {
  if (input.hasEverVoted || input.totalVotes > 0) return false;
  if (!input.seenRaw) return true;
  if (input.seenRaw === "true") return false;
  const ts = Number(input.seenRaw);
  if (!Number.isFinite(ts)) return true;
  return input.now - ts > input.reShowAfterDays * MS_PER_DAY;
}

export function persistHowItWorksTourSeen(now = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOW_IT_WORKS_TOUR_STORAGE_KEY, String(now));
  } catch {
    /* private mode */
  }
}
