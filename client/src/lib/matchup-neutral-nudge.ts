export type MatchupNeutralVoteOption = "option_a" | "option_b" | "neutral";

interface StoredMatchupNeutralVotes {
  votesByMatchupId: Record<string, MatchupNeutralVoteOption>;
  behavioralReminderUsed: boolean;
}

const INITIAL_MORPH_LIFETIME_KEY = "voxdex_matchup_neutral_morph_lifetime_count";
const SESSION_MORPH_IDS_KEY = "voxdex_matchup_neutral_morph_session_ids";
const SESSION_MORPH_COUNT_KEY = "voxdex_matchup_neutral_morph_session_count";
const SESSION_REMINDER_ACTIVE_KEY = "voxdex_matchup_neutral_reminder_session_active";
const SESSION_REMINDER_MORPH_COUNT_KEY = "voxdex_matchup_neutral_reminder_morph_session_count";
const SESSION_HESITATION_IDS_KEY = "voxdex_matchup_neutral_hesitation_session_ids";
const SESSION_HESITATION_COUNT_KEY = "voxdex_matchup_neutral_hesitation_session_count";
const VOTE_STATS_KEY = "voxdex_matchup_neutral_vote_stats_v1";

/** Lifetime cap spreads the education phase across ~3 sessions instead of one. */
const LIFETIME_MORPH_LIMIT = 9;
const SESSION_MORPH_LIMIT = 3;
const REMINDER_MORPH_LIMIT = 2;
const HESITATION_NUDGE_LIMIT = 2;
const BEHAVIORAL_REMINDER_MIN_VOTES = 15;

/** Relaxed caps for mobile where scroll/dwell education needs higher frequency. */
const MOBILE_LIFETIME_MORPH_LIMIT = 20;
const MOBILE_SESSION_MORPH_LIMIT = 10;
const MOBILE_HESITATION_NUDGE_LIMIT = 10;

function getLifetimeMorphLimit(isMobile = false): number {
  return isMobile ? MOBILE_LIFETIME_MORPH_LIMIT : LIFETIME_MORPH_LIMIT;
}

function getSessionMorphLimit(isMobile = false): number {
  return isMobile ? MOBILE_SESSION_MORPH_LIMIT : SESSION_MORPH_LIMIT;
}

function getHesitationNudgeLimit(isMobile = false): number {
  return isMobile ? MOBILE_HESITATION_NUDGE_LIMIT : HESITATION_NUDGE_LIMIT;
}

/**
 * Single-morph lock: while one card's VS button is morphing, other visible
 * cards must not consume budget (they may morph on a later view entry).
 * Covers the 2s hold plus both crossfades with a little buffer.
 */
const MORPH_LOCK_MS = 2600;
let morphLockUntil = 0;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function readNumber(storage: Storage | null, key: string): number {
  if (!storage) return 0;
  try {
    const value = Number(storage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeNumber(storage: Storage | null, key: string, value: number): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(value));
  } catch {
    /* Storage is optional in private browsing. */
  }
}

function readStringSet(storage: Storage | null, key: string): Set<string> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeStringSet(storage: Storage | null, key: string, value: Set<string>): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* Storage is optional in private browsing. */
  }
}

function isMatchupNeutralVoteOption(value: unknown): value is MatchupNeutralVoteOption {
  return value === "option_a" || value === "option_b" || value === "neutral";
}

function readStoredVotes(storage: Storage | null): StoredMatchupNeutralVotes {
  const fallback: StoredMatchupNeutralVotes = {
    votesByMatchupId: {},
    behavioralReminderUsed: false,
  };

  if (!storage) return fallback;

  try {
    const parsed = JSON.parse(storage.getItem(VOTE_STATS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;

    const raw = parsed as {
      votesByMatchupId?: unknown;
      behavioralReminderUsed?: unknown;
    };
    const entries =
      raw.votesByMatchupId && typeof raw.votesByMatchupId === "object"
        ? Object.entries(raw.votesByMatchupId as Record<string, unknown>)
        : [];

    return {
      votesByMatchupId: Object.fromEntries(
        entries.filter((entry): entry is [string, MatchupNeutralVoteOption] =>
          typeof entry[0] === "string" && isMatchupNeutralVoteOption(entry[1]),
        ),
      ),
      behavioralReminderUsed: raw.behavioralReminderUsed === true,
    };
  } catch {
    return fallback;
  }
}

/**
 * In-memory state, hydrated from local/session storage once and written
 * through on mutation. Nudge checks fire from timers and intersection
 * callbacks, so they must never re-parse JSON blobs per call.
 */
interface NudgeCache {
  lifetimeMorphCount: number;
  sessionMorphCount: number;
  sessionMorphIds: Set<string>;
  reminderActive: boolean;
  reminderMorphCount: number;
  hesitationCount: number;
  hesitationIds: Set<string>;
  voteStats: StoredMatchupNeutralVotes;
  sessionGuaranteedShimmerIds: Set<string>;
}

let cache: NudgeCache | null = null;

function getCache(): NudgeCache {
  if (cache) return cache;

  const local = getLocalStorage();
  const session = getSessionStorage();

  cache = {
    lifetimeMorphCount: readNumber(local, INITIAL_MORPH_LIFETIME_KEY),
    sessionMorphCount: readNumber(session, SESSION_MORPH_COUNT_KEY),
    sessionMorphIds: readStringSet(session, SESSION_MORPH_IDS_KEY),
    reminderActive: readNumber(session, SESSION_REMINDER_ACTIVE_KEY) > 0,
    reminderMorphCount: readNumber(session, SESSION_REMINDER_MORPH_COUNT_KEY),
    hesitationCount: readNumber(session, SESSION_HESITATION_COUNT_KEY),
    hesitationIds: readStringSet(session, SESSION_HESITATION_IDS_KEY),
    voteStats: readStoredVotes(local),
    sessionGuaranteedShimmerIds: new Set(),
  };
  return cache;
}

function persistVoteStats(state: NudgeCache): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(VOTE_STATS_KEY, JSON.stringify(state.voteStats));
  } catch {
    /* Storage is optional in private browsing. */
  }
}

function canUseBehavioralReminder(state: NudgeCache): boolean {
  if (state.voteStats.behavioralReminderUsed) return false;
  const votes = Object.values(state.voteStats.votesByMatchupId);
  return (
    votes.length >= BEHAVIORAL_REMINDER_MIN_VOTES &&
    !votes.some((vote) => vote === "neutral")
  );
}

export function trackMatchupNeutralVote(
  matchupId: string,
  option: MatchupNeutralVoteOption,
): void {
  const state = getCache();
  state.voteStats.votesByMatchupId[matchupId] = option;
  if (option === "neutral") {
    state.voteStats.behavioralReminderUsed = true;
  }
  persistVoteStats(state);
}

export function removeTrackedMatchupNeutralVote(matchupId: string): void {
  const state = getCache();
  if (!(matchupId in state.voteStats.votesByMatchupId)) return;
  delete state.voteStats.votesByMatchupId[matchupId];
  persistVoteStats(state);
}

/**
 * Pure in-memory eligibility check — no consumption, no storage access after
 * first hydration. Ignores the transient morph lock (the card may still morph
 * on a later view entry). Lets the hook skip all observer/timer work for
 * cards that can never morph this session.
 */
export function isMorphPossible(matchupId: string, isMobile = false): boolean {
  const state = getCache();
  if (state.sessionMorphIds.has(matchupId)) return false;
  const lifetimeLimit = getLifetimeMorphLimit(isMobile);
  const sessionLimit = getSessionMorphLimit(isMobile);
  if (state.lifetimeMorphCount < lifetimeLimit && state.sessionMorphCount < sessionLimit) {
    return true;
  }
  return (
    (state.reminderActive || canUseBehavioralReminder(state)) &&
    state.reminderMorphCount < REMINDER_MORPH_LIMIT
  );
}

/** Pure in-memory eligibility check — hesitation counterpart of isMorphPossible. */
export function isHesitationPossible(matchupId: string, isMobile = false): boolean {
  const state = getCache();
  return !state.hesitationIds.has(matchupId) && state.hesitationCount < getHesitationNudgeLimit(isMobile);
}

/** Whether this card has received its guaranteed-once shimmer this session. */
export function hasGuaranteedShimmer(matchupId: string): boolean {
  return getCache().sessionGuaranteedShimmerIds.has(matchupId);
}

/** Mark guaranteed shimmer as shown for this card this session. */
export function markGuaranteedShimmer(matchupId: string): void {
  getCache().sessionGuaranteedShimmerIds.add(matchupId);
}

export function consumeMatchupNeutralMorph(matchupId: string, isMobile = false): boolean {
  // Another card is mid-morph: skip WITHOUT consuming budget or marking this
  // card as seen, so it may still morph on a later view entry.
  if (Date.now() < morphLockUntil) return false;

  const state = getCache();
  if (state.sessionMorphIds.has(matchupId)) return false;

  const session = getSessionStorage();
  const lifetimeLimit = getLifetimeMorphLimit(isMobile);
  const sessionLimit = getSessionMorphLimit(isMobile);

  if (state.lifetimeMorphCount < lifetimeLimit && state.sessionMorphCount < sessionLimit) {
    state.lifetimeMorphCount += 1;
    state.sessionMorphCount += 1;
    state.sessionMorphIds.add(matchupId);
    writeNumber(getLocalStorage(), INITIAL_MORPH_LIFETIME_KEY, state.lifetimeMorphCount);
    writeNumber(session, SESSION_MORPH_COUNT_KEY, state.sessionMorphCount);
    writeStringSet(session, SESSION_MORPH_IDS_KEY, state.sessionMorphIds);
    morphLockUntil = Date.now() + MORPH_LOCK_MS;
    return true;
  }

  if (
    (state.reminderActive || canUseBehavioralReminder(state)) &&
    state.reminderMorphCount < REMINDER_MORPH_LIMIT
  ) {
    if (!state.reminderActive) {
      state.reminderActive = true;
      state.voteStats.behavioralReminderUsed = true;
      persistVoteStats(state);
      writeNumber(session, SESSION_REMINDER_ACTIVE_KEY, 1);
    }
    state.reminderMorphCount += 1;
    state.sessionMorphIds.add(matchupId);
    writeNumber(session, SESSION_REMINDER_MORPH_COUNT_KEY, state.reminderMorphCount);
    writeStringSet(session, SESSION_MORPH_IDS_KEY, state.sessionMorphIds);
    morphLockUntil = Date.now() + MORPH_LOCK_MS;
    return true;
  }

  return false;
}

export function consumeMatchupNeutralHesitation(matchupId: string, isMobile = false): boolean {
  const state = getCache();
  if (state.hesitationIds.has(matchupId)) return false;
  if (state.hesitationCount >= getHesitationNudgeLimit(isMobile)) return false;

  const session = getSessionStorage();
  state.hesitationCount += 1;
  state.hesitationIds.add(matchupId);
  writeNumber(session, SESSION_HESITATION_COUNT_KEY, state.hesitationCount);
  writeStringSet(session, SESSION_HESITATION_IDS_KEY, state.hesitationIds);
  return true;
}
