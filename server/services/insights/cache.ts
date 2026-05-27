import { eq } from "drizzle-orm";
import { apiCache } from "@shared/schema";
import { db } from "../../db";

export const INSIGHTS_AGGREGATE_TTL_MS = 90 * 1000;
export const INSIGHTS_STORY_TTL_MS = 30 * 60 * 60 * 1000;

export async function getInsightsCache<T>(cacheKey: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(apiCache)
    .where(eq(apiCache.cacheKey, cacheKey))
    .limit(1);

  if (!row || row.expiresAt <= new Date()) {
    return null;
  }

  try {
    return JSON.parse(row.responseData) as T;
  } catch {
    return null;
  }
}

export async function setInsightsCache(
  cacheKey: string,
  provider: string,
  payload: unknown,
  ttlMs: number,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const responseData = JSON.stringify(payload);

  await db
    .insert(apiCache)
    .values({
      cacheKey,
      provider,
      responseData,
      fetchedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        provider,
        responseData,
        fetchedAt: now,
        expiresAt,
      },
    });
}
