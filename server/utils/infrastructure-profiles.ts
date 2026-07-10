/** Fixed UUIDs — must match migrations 0052 (house) and 0086 (scout). */
export const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";
export const SCOUT_PROFILE_ID = "00000000-0000-0000-0000-0000000000bb";

export const INFRASTRUCTURE_PROFILE_IDS = [
  HOUSE_PROFILE_ID,
  SCOUT_PROFILE_ID,
] as const;

export function isInfrastructureProfile(profile: {
  id: string;
  role?: string | null;
}): boolean {
  return (
    profile.role === "system" ||
    (INFRASTRUCTURE_PROFILE_IDS as readonly string[]).includes(profile.id)
  );
}

export const INFRASTRUCTURE_PROFILE_DENY = {
  error: "infrastructure_profile" as const,
  message:
    "This is a platform infrastructure account and cannot be modified from the Users panel. " +
    "House is managed via Admin → AMM; Market Scout via World Markets.",
};
