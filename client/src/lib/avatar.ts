export const AVATAR_TEXT_CLASS = "text-white font-semibold";

export const HUMAN_AVATAR_FALLBACK_CLASS = AVATAR_TEXT_CLASS;
export const AGENT_AVATAR_FALLBACK_CLASS = AVATAR_TEXT_CLASS;

/* Rich complementary gradients for user avatars - vibrant hues with depth */
const GRADIENT_PAIRS = [
  "bg-gradient-to-br from-pink-500 via-violet-500 to-purple-700",
  "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-600",
  "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600",
  "bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600",
  "bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600",
  "bg-gradient-to-br from-amber-500 via-orange-500 to-rose-600",
  "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600",
  "bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-600",
  "bg-gradient-to-br from-teal-500 via-cyan-500 to-blue-600",
  "bg-gradient-to-br from-fuchsia-500 via-pink-500 to-rose-600",
  "bg-gradient-to-br from-orange-500 via-amber-500 to-rose-500",
  "bg-gradient-to-br from-sky-500 via-blue-500 to-violet-600",
];

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

export function getAvatarGradient(name: string | null | undefined): string {
  const value = (name ?? "").trim().toLowerCase();
  const index = djb2Hash(value) % GRADIENT_PAIRS.length;
  return GRADIENT_PAIRS[index];
}

/**
 * Derive 1–2 character initials for a user avatar fallback.
 *
 * Rule: first letter of first word + first letter of LAST word (skips middles),
 * single letter for single-word names, "?" for empty/whitespace input.
 * Callers that have both displayName and username should pass
 * `displayName || username` (displayName takes precedence).
 *
 * Unicode-safe: uses Array.from to avoid splitting surrogate pairs.
 */
export function getAvatarInitials(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  if (!value) return "?";

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const firstChar = (word: string) => (Array.from(word)[0] ?? "").toUpperCase();

  if (parts.length === 1) {
    return firstChar(parts[0]);
  }

  return `${firstChar(parts[0])}${firstChar(parts[parts.length - 1])}`;
}
