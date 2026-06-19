/**
 * Per-tier profile visual unlocks (Phase 5 rank redesign) — single
 * source of truth shared by the server (write-time tier gating +
 * validation) and the client (Settings UI + profile rendering).
 *
 * Two unlocks, both stored on `profiles` but rendered conditionally on
 * the user's CURRENT rank tier so a demotion hides rather than deletes:
 *   - Custom profile banner — earned at Maven (Tier 6+).
 *   - Profile accent theme  — earned at VoxMax Legend (Tier 8).
 */

/** Minimum rank tier required to set / render a custom profile banner. */
export const PROFILE_BANNER_MIN_TIER = 6;

/** Minimum rank tier required to set / render a custom profile theme. */
export const PROFILE_THEME_MIN_TIER = 8;

export interface ProfileThemeConfig {
  /** Stored key (profiles.profileTheme). */
  key: string;
  /** Human label for the Settings selector. */
  label: string;
  /** Primary accent (hex) used for highlights/borders on the profile. */
  accent: string;
  /** Two-stop gradient (hex) for the profile header backdrop wash. */
  gradient: [string, string];
}

/**
 * The three Legend theme presets. Palettes are documented here so the
 * Settings preview and the profile renderer can't drift apart.
 */
export const PROFILE_THEMES: readonly ProfileThemeConfig[] = [
  {
    key: "midnight",
    label: "Midnight",
    accent: "#6366F1",
    gradient: ["#1E1B4B", "#0F172A"],
  },
  {
    key: "ember",
    label: "Ember",
    accent: "#F97316",
    gradient: ["#7C2D12", "#171717"],
  },
  {
    key: "aurora",
    label: "Aurora",
    accent: "#14B8A6",
    gradient: ["#134E4A", "#0F172A"],
  },
] as const;

export type ProfileThemeKey = (typeof PROFILE_THEMES)[number]["key"];

export function isValidProfileThemeKey(value: unknown): value is ProfileThemeKey {
  return (
    typeof value === "string" &&
    PROFILE_THEMES.some((theme) => theme.key === value)
  );
}

export function getProfileTheme(
  key: string | null | undefined,
): ProfileThemeConfig | null {
  if (!key) return null;
  return PROFILE_THEMES.find((theme) => theme.key === key) ?? null;
}
