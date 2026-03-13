export const HUMAN_AVATAR_FALLBACK_CLASS =
  "bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold";

export const AGENT_AVATAR_FALLBACK_CLASS =
  "bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold";

export function getAvatarInitials(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  if (!value) {
    return "U";
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}
