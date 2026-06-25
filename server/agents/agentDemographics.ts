/**
 * Deterministic demographic + onboarding fields for simulation agents.
 * Keyed by username so re-runs and backfills stay idempotent.
 */

import type { EthnicityValue } from "@shared/ethnicity";

export type AgentDemographicSeedInput = {
  username: string;
  bio: string;
  specialties: string[];
  createdAt: Date;
};

export type AgentDemographicFields = {
  bio: string;
  gender: string;
  countryOfResidence: string;
  countryOfOrigin: string;
  dateOfBirth: string;
  ethnicity: string;
  tosAcceptedAt: Date;
  onboardingStep: number;
  onboardingCompletedAt: Date;
  statedInterests: string[];
};

function hashNumber(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(input: string): number {
  return hashNumber(input) / 0xffffffff;
}

function seededRoll(input: string, min: number, max: number): number {
  return min + (max - min) * seededUnit(input);
}

/** Western-weighted ISO alpha-2 codes (must pass routes isIsoCountry). */
const COUNTRY_POOL: Array<{ code: string; cumulative: number }> = (() => {
  const entries: Array<{ code: string; weight: number }> = [
    { code: "US", weight: 0.34 },
    { code: "GB", weight: 0.12 },
    { code: "CA", weight: 0.07 },
    { code: "AU", weight: 0.06 },
    { code: "DE", weight: 0.05 },
    { code: "IE", weight: 0.04 },
    { code: "FR", weight: 0.04 },
    { code: "NL", weight: 0.03 },
    { code: "ZA", weight: 0.06 },
    { code: "IN", weight: 0.05 },
    { code: "BR", weight: 0.04 },
    { code: "MX", weight: 0.03 },
    { code: "ES", weight: 0.03 },
    { code: "IT", weight: 0.02 },
    { code: "SE", weight: 0.02 },
    { code: "NZ", weight: 0.02 },
    { code: "SG", weight: 0.02 },
  ];
  let cumulative = 0;
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map((entry) => {
    cumulative += entry.weight / totalWeight;
    return { code: entry.code, cumulative };
  });
})();

const GENDER_POOL: Array<{ value: string; cumulative: number }> = [
  { value: "male", cumulative: 0.62 },
  { value: "female", cumulative: 0.95 },
  { value: "prefer_not_to_say", cumulative: 1 },
];

const ETHNICITY_POOL: Array<{ value: EthnicityValue; cumulative: number }> = [
  { value: "white", cumulative: 0.4 },
  { value: "african_black", cumulative: 0.58 },
  { value: "asian", cumulative: 0.7 },
  { value: "coloured", cumulative: 0.78 },
  { value: "indian", cumulative: 0.84 },
  { value: "hispanic", cumulative: 0.9 },
  { value: "middle_eastern", cumulative: 0.94 },
  { value: "indigenous", cumulative: 0.96 },
  { value: "pacific_islander", cumulative: 0.98 },
  { value: "other", cumulative: 0.995 },
  { value: "prefer_not_to_say", cumulative: 1 },
];

const SPECIALTY_TO_INTEREST: Record<string, string> = {
  sports: "sports",
  entertainment: "film-tv",
  music: "music",
  creator: "creator",
  business: "business",
  politics: "politics",
  tech: "tech",
};

function pickFromCumulativePool<T extends string>(
  key: string,
  pool: Array<{ value?: T; code?: string; cumulative: number }>,
  valueKey: "value" | "code",
): T {
  const roll = seededUnit(key);
  for (const entry of pool) {
    if (roll < entry.cumulative) {
      return (entry[valueKey] ?? entry.value) as T;
    }
  }
  const last = pool[pool.length - 1];
  return (last[valueKey] ?? last.value) as T;
}

function pickCountry(username: string, suffix: string): string {
  const roll = seededUnit(`${username}:${suffix}`);
  for (const entry of COUNTRY_POOL) {
    if (roll < entry.cumulative) return entry.code;
  }
  return COUNTRY_POOL[COUNTRY_POOL.length - 1].code;
}

function mapSpecialtiesToInterests(specialties: string[]): string[] {
  const mapped = specialties
    .map((s) => SPECIALTY_TO_INTEREST[s] ?? s)
    .filter((id, index, arr) => arr.indexOf(id) === index);
  return mapped.length > 0 ? mapped : ["misc"];
}

function backdatedOnboardingTimestamp(createdAt: Date): Date {
  const completed = new Date(createdAt);
  // Welcome flow typically finishes within a day of signup.
  completed.setHours(
    completed.getHours() + Math.round(seededRoll(`${completed.toISOString()}:onboard`, 1, 20)),
  );
  return completed;
}

export function assignAgentDemographics(
  input: AgentDemographicSeedInput,
): AgentDemographicFields {
  const { username, bio, specialties, createdAt } = input;
  const gender = pickFromCumulativePool(username, GENDER_POOL, "value");
  const countryOfResidence = pickCountry(username, "country-residence");
  const sameOrigin = seededUnit(`${username}:origin-match`) < 0.7;
  const countryOfOrigin = sameOrigin
    ? countryOfResidence
    : pickCountry(username, "country-origin");

  const age = Math.round(seededRoll(`${username}:dob-age`, 22, 45));
  const birthYear = createdAt.getFullYear() - age;
  const dateOfBirth = `${birthYear}-01-01`;

  const ethnicity = pickFromCumulativePool(
    `${username}:ethnicity`,
    ETHNICITY_POOL,
    "value",
  );

  const onboardingCompletedAt = backdatedOnboardingTimestamp(createdAt);
  const tosAcceptedAt = new Date(createdAt);
  tosAcceptedAt.setMinutes(
    tosAcceptedAt.getMinutes() + Math.round(seededRoll(`${username}:tos`, 2, 45)),
  );

  return {
    bio,
    gender,
    countryOfResidence,
    countryOfOrigin,
    dateOfBirth,
    ethnicity,
    tosAcceptedAt,
    onboardingStep: 5,
    onboardingCompletedAt,
    statedInterests: mapSpecialtiesToInterests(specialties),
  };
}
