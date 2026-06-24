import { db } from "../db";
import {
  celebrityProfiles,
  trackedPeople,
  type TrackedPerson,
  type TrendingPerson,
} from "@shared/schema";
import { eq, and, or, isNull, lt, ne, sql } from "drizzle-orm";
import {
  getOrGenerateCelebrityProfile,
  PROFILE_PROMPT_VERSION,
  PROFILE_BIO_CRON_REFRESH_DAYS,
} from "../services/profile-generator";
import { refreshNetWorth, classifyNetWorthVolatility } from "../services/net-worth-refresher";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

export function toTrendingPerson(person: TrackedPerson): TrendingPerson {
  return {
    id: person.id,
    name: person.name,
    avatar: person.avatar ?? null,
    bio: person.bio ?? null,
    rank: person.displayOrder || 9999,
    trendScore: 0,
    fameIndex: 0,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: null,
    change7d: null,
    category: person.category,
    secondaryCategories: person.secondaryCategories ?? [],
    profileViews10m: null,
  };
}

export interface CelebrityProfileCronResult {
  total: number;
  refreshed: number;
  skipped: number;
  errors: number;
  errorNames: string[];
  durationMs: number;
}

/** Regenerate bios only when stale metadata or past cron refresh threshold. */
export async function runCelebrityProfileCronRefresh(): Promise<CelebrityProfileCronResult> {
  const startTime = Date.now();
  const cutoff = new Date(Date.now() - PROFILE_BIO_CRON_REFRESH_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      person: trackedPeople,
      profile: celebrityProfiles,
    })
    .from(trackedPeople)
    .leftJoin(celebrityProfiles, eq(celebrityProfiles.personId, trackedPeople.id))
    .where(eq(trackedPeople.status, "main_leaderboard"));

  const needsRefresh = rows.filter(({ profile }) => {
    if (!profile) return true;
    const promptVersion = profile.promptVersion ?? 0;
    if (!profile.sourceHash) return true;
    if (promptVersion < PROFILE_PROMPT_VERSION) return true;
    if (profile.generatedAt < cutoff) return true;
    return false;
  });

  let refreshed = 0;
  let skipped = 0;
  let errors = 0;
  const errorNames: string[] = [];

  for (let i = 0; i < needsRefresh.length; i += BATCH_SIZE) {
    const batch = needsRefresh.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ person }) => {
        try {
          const volatility = classifyNetWorthVolatility(person.category);
          await getOrGenerateCelebrityProfile(toTrendingPerson(person), { forceRefresh: true });
          await db
            .update(celebrityProfiles)
            .set({ netWorthVolatility: volatility })
            .where(eq(celebrityProfiles.personId, person.id));
          refreshed++;
        } catch (err: any) {
          errors++;
          errorNames.push(`${person.name}: ${err.message}`);
          console.error(`[ProfileCron] Failed ${person.name}:`, err.message);
        }
      }),
    );
    if (i + BATCH_SIZE < needsRefresh.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  skipped = rows.length - needsRefresh.length;

  return {
    total: rows.length,
    refreshed,
    skipped,
    errors,
    errorNames: errorNames.slice(0, 20),
    durationMs: Date.now() - startTime,
  };
}

export interface NetWorthCronResult {
  total: number;
  candidates: number;
  wrote: number;
  kept: number;
  providerUnavailable: number;
  errors: number;
  errorNames: string[];
  durationMs: number;
}

/** Refresh net worth only (no OpenAI bio regen). */
export async function runNetWorthCronRefresh(
  volatility: "standard" | "high" = "standard",
): Promise<NetWorthCronResult> {
  const startTime = Date.now();
  const intervalDays = volatility === "high" ? 1 : 7;
  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(trackedPeople.status, "main_leaderboard"),
    volatility === "high"
      ? eq(celebrityProfiles.netWorthVolatility, "high")
      : ne(celebrityProfiles.netWorthVolatility, "high"),
    or(isNull(celebrityProfiles.netWorthUpdatedAt), lt(celebrityProfiles.netWorthUpdatedAt, cutoff)),
  ];

  const rows = await db
    .select({
      personId: celebrityProfiles.personId,
      personName: celebrityProfiles.personName,
      category: trackedPeople.category,
    })
    .from(celebrityProfiles)
    .innerJoin(trackedPeople, eq(trackedPeople.id, celebrityProfiles.personId))
    .where(and(...conditions));

  let wrote = 0;
  let kept = 0;
  let providerUnavailable = 0;
  let errors = 0;
  const errorNames: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const vol = classifyNetWorthVolatility(row.category);
          const result = await refreshNetWorth(row.personId, row.personName, vol);
          if (result.outcome === "wrote") wrote++;
          else if (result.outcome === "kept") kept++;
          else providerUnavailable++;
        } catch (err: any) {
          errors++;
          errorNames.push(`${row.personName}: ${err.message}`);
          console.error(`[NetWorthCron] Failed ${row.personName}:`, err.message);
        }
      }),
    );
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const [{ count: totalProfilesCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(celebrityProfiles)
    .innerJoin(trackedPeople, eq(trackedPeople.id, celebrityProfiles.personId))
    .where(eq(trackedPeople.status, "main_leaderboard"));

  return {
    total: Number(totalProfilesCount),
    candidates: rows.length,
    wrote,
    kept,
    providerUnavailable,
    errors,
    errorNames: errorNames.slice(0, 20),
    durationMs: Date.now() - startTime,
  };
}
