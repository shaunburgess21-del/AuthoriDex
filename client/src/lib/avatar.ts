export const AVATAR_TEXT_CLASS = "text-white font-semibold";

export const HUMAN_AVATAR_FALLBACK_CLASS = AVATAR_TEXT_CLASS;
export const AGENT_AVATAR_FALLBACK_CLASS = AVATAR_TEXT_CLASS;

const GRADIENT_PAIRS = [
  "bg-gradient-to-br from-blue-500 to-purple-600",
  "bg-gradient-to-br from-emerald-500 to-cyan-600",
  "bg-gradient-to-br from-rose-500 to-orange-500",
  "bg-gradient-to-br from-violet-500 to-fuchsia-500",
  "bg-gradient-to-br from-amber-500 to-pink-500",
  "bg-gradient-to-br from-teal-500 to-blue-500",
  "bg-gradient-to-br from-indigo-500 to-sky-400",
  "bg-gradient-to-br from-pink-500 to-violet-600",
  "bg-gradient-to-br from-lime-500 to-emerald-600",
  "bg-gradient-to-br from-cyan-500 to-indigo-500",
  "bg-gradient-to-br from-orange-500 to-red-600",
  "bg-gradient-to-br from-fuchsia-500 to-rose-500",
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
