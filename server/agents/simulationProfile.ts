export const SIMULATION_V2_COHORT_ID = "v2-2026-prelaunch";

export type SimulationPersonaBand =
  | "sharp"
  | "casual"
  | "noisy"
  | "liquidity"
  | "whale";

export interface AgentSimulationProfile {
  schemaVersion: 2;
  cohortId: string;
  personaBand: SimulationPersonaBand;
  skillTier: number;
  favoriteCategories: string[];
  edgeThreshold: number;
  publicConfidenceRate: number;
  stakeMultiplier: number;
  minStake: number;
  maxStake: number;
  weeklyVoteCap: number;
  weeklyCommentCap: number;
  dailyVoteChance: number;
  dailyCommentChance: number;
  commentStyle: "short" | "skeptical" | "analytical" | "casual";
  bankrollProfile: "small" | "normal" | "large";
}

const DEFAULT_SIMULATION_PROFILE: AgentSimulationProfile = {
  schemaVersion: 2,
  cohortId: SIMULATION_V2_COHORT_ID,
  personaBand: "casual",
  skillTier: 0.5,
  favoriteCategories: [],
  edgeThreshold: -0.02,
  publicConfidenceRate: 0.25,
  stakeMultiplier: 1,
  minStake: 75,
  maxStake: 250,
  // Halved from 8 -> 4 alongside the band-specific tunes once vote
  // volume stabilised at a healthy pace. Half is still reserved for
  // inline voting from the comment sweep (vote-first rule), the rest
  // funds the standalone vote sweep.
  weeklyVoteCap: 3,
  // Dialled down ~50% from the post-fix default (3) once the cohort
  // started commenting hard and fast across all surfaces. Pairs with
  // halved dailyCommentChance below so volume and pacing both ease.
  weeklyCommentCap: 2,
  dailyVoteChance: 0.18,
  dailyCommentChance: 0.026,
  commentStyle: "casual",
  bankrollProfile: "normal",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function getSimulationProfile(value: unknown): AgentSimulationProfile {
  if (!isRecord(value)) return DEFAULT_SIMULATION_PROFILE;

  return {
    schemaVersion: 2,
    cohortId: typeof value.cohortId === "string" ? value.cohortId : SIMULATION_V2_COHORT_ID,
    personaBand: enumOr(
      value.personaBand,
      ["sharp", "casual", "noisy", "liquidity", "whale"] as const,
      DEFAULT_SIMULATION_PROFILE.personaBand,
    ),
    skillTier: numberOr(value.skillTier, DEFAULT_SIMULATION_PROFILE.skillTier),
    favoriteCategories: stringArrayOr(value.favoriteCategories, []),
    edgeThreshold: numberOr(value.edgeThreshold, DEFAULT_SIMULATION_PROFILE.edgeThreshold),
    publicConfidenceRate: numberOr(value.publicConfidenceRate, DEFAULT_SIMULATION_PROFILE.publicConfidenceRate),
    stakeMultiplier: numberOr(value.stakeMultiplier, DEFAULT_SIMULATION_PROFILE.stakeMultiplier),
    minStake: Math.round(numberOr(value.minStake, DEFAULT_SIMULATION_PROFILE.minStake)),
    maxStake: Math.round(numberOr(value.maxStake, DEFAULT_SIMULATION_PROFILE.maxStake)),
    weeklyVoteCap: Math.round(numberOr(value.weeklyVoteCap, DEFAULT_SIMULATION_PROFILE.weeklyVoteCap)),
    weeklyCommentCap: Math.round(numberOr(value.weeklyCommentCap, DEFAULT_SIMULATION_PROFILE.weeklyCommentCap)),
    dailyVoteChance: numberOr(value.dailyVoteChance, DEFAULT_SIMULATION_PROFILE.dailyVoteChance),
    dailyCommentChance: numberOr(value.dailyCommentChance, DEFAULT_SIMULATION_PROFILE.dailyCommentChance),
    commentStyle: enumOr(
      value.commentStyle,
      ["short", "skeptical", "analytical", "casual"] as const,
      DEFAULT_SIMULATION_PROFILE.commentStyle,
    ),
    bankrollProfile: enumOr(
      value.bankrollProfile,
      ["small", "normal", "large"] as const,
      DEFAULT_SIMULATION_PROFILE.bankrollProfile,
    ),
  };
}

export function isV2SimulationProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.cohortId === SIMULATION_V2_COHORT_ID;
}

export function shouldShowPublicConfidence(profile: AgentSimulationProfile, stableKey: string): boolean {
  let hash = 2166136261;
  for (let i = 0; i < stableKey.length; i++) {
    hash ^= stableKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const roll = (hash >>> 0) / 0xffffffff;
  return roll < profile.publicConfidenceRate;
}
