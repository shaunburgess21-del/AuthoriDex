import { eq } from "drizzle-orm";
import { db } from "../db";
import { matchups } from "@shared/schema";
import { voteSlugIn } from "../lib/vote-slug";

/** PostgreSQL gen_random_uuid() style */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLikelyMatchupUuid(param: string): boolean {
  return UUID_RE.test(param);
}

/**
 * Resolve a matchup from a URL segment that may be either slug or primary key (UUID).
 * Applies the same visibility rules as the public detail API (live or inactive only).
 */
export async function resolvePublicMatchupBySlugOrId(
  raw: string | undefined
): Promise<typeof matchups.$inferSelect | null> {
  if (raw == null || raw === "") return null;
  let param = raw.trim();
  try {
    param = decodeURIComponent(param);
  } catch {
    /* ignore malformed escape sequences */
  }
  if (!param) return null;

  const [bySlug] = await db.select().from(matchups).where(voteSlugIn(matchups.slug, param));
  let row = bySlug;
  if (!row && isLikelyMatchupUuid(param)) {
    const [byId] = await db.select().from(matchups).where(eq(matchups.id, param));
    row = byId;
  }
  if (!row) return null;
  if (row.visibility !== "live" && row.visibility !== "inactive") {
    return null;
  }
  return row;
}
