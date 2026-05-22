import type { PersonOgContext } from "./person-og-context";

const OG_DESCRIPTION_MAX = 200;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trim()}...`;
}

/** og:description — bio stays out of the JPEG. */
export function personOgDescription(ctx: PersonOgContext): string {
  const bio =
    (ctx.shortBio || ctx.longBio || ctx.bio || "").trim();
  if (bio) return truncate(bio, OG_DESCRIPTION_MAX);
  return `Track ${ctx.name} on VoxDex.`;
}
