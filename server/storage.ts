import { type TrendingPerson, type CelebrityProfile, type InsertCelebrityProfile, celebrityProfiles, trendingPeople } from "@shared/schema";
import { canonicalizePersonCategory } from "@shared/constants";
import { db } from "./db";
import { eq, asc, sql } from "drizzle-orm";

const PROFILE_METADATA_FALLBACK_VERSION = 2;

const celebrityProfileBaseColumns = {
  id: celebrityProfiles.id,
  personId: celebrityProfiles.personId,
  personName: celebrityProfiles.personName,
  shortBio: celebrityProfiles.shortBio,
  longBio: celebrityProfiles.longBio,
  knownFor: celebrityProfiles.knownFor,
  fromCountry: celebrityProfiles.fromCountry,
  fromCountryCode: celebrityProfiles.fromCountryCode,
  basedIn: celebrityProfiles.basedIn,
  basedInCountryCode: celebrityProfiles.basedInCountryCode,
  estimatedNetWorth: celebrityProfiles.estimatedNetWorth,
  generatedAt: celebrityProfiles.generatedAt,
};

function isMissingProfileMetadataError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err?.code === "42703" || /column .*?(prompt_version|source_hash|source_urls|confidence|as_of_date|validation_notes).*?does not exist/i.test(err?.message ?? "");
}

function withFallbackProfileMetadata(profile: typeof celebrityProfiles.$inferSelect | any): CelebrityProfile {
  return {
    ...profile,
    promptVersion: profile.promptVersion ?? PROFILE_METADATA_FALLBACK_VERSION,
    sourceHash: profile.sourceHash ?? null,
    sourceUrls: profile.sourceUrls ?? null,
    confidence: profile.confidence ?? null,
    asOfDate: profile.asOfDate ?? null,
    validationNotes: profile.validationNotes ?? null,
  } as CelebrityProfile;
}

function stripProfileMetadata(profile: Partial<InsertCelebrityProfile>): Partial<InsertCelebrityProfile> {
  const {
    promptVersion: _promptVersion,
    sourceHash: _sourceHash,
    sourceUrls: _sourceUrls,
    confidence: _confidence,
    asOfDate: _asOfDate,
    validationNotes: _validationNotes,
    ...legacyProfile
  } = profile as any;
  return legacyProfile as Partial<InsertCelebrityProfile>;
}

export interface IStorage {
  getTrendingPeople(): Promise<TrendingPerson[]>;
  getTrendingPerson(id: string): Promise<TrendingPerson | undefined>;
  updateTrendingPeople(people: TrendingPerson[]): Promise<void>;
  getCelebrityProfile(personId: string): Promise<CelebrityProfile | undefined>;
  setCelebrityProfile(profile: InsertCelebrityProfile): Promise<CelebrityProfile>;
  updateCelebrityProfile(personId: string, profile: Partial<InsertCelebrityProfile>): Promise<CelebrityProfile | undefined>;
  /** Partial update without bumping generatedAt (net worth, volatility, etc.). */
  updateCelebrityProfileFields(
    personId: string,
    fields: Partial<InsertCelebrityProfile>,
  ): Promise<CelebrityProfile | undefined>;
}

export class MemStorage implements IStorage {
  private trendingPeople: Map<string, TrendingPerson>;

  constructor() {
    this.trendingPeople = new Map();
  }

  async getTrendingPeople(): Promise<TrendingPerson[]> {
    const dbPeople = await db
      .select()
      .from(trendingPeople)
      .orderBy(asc(trendingPeople.rank));
    
    if (dbPeople.length > 0) {
      return dbPeople;
    }
    return Array.from(this.trendingPeople.values());
  }

  async getTrendingPerson(id: string): Promise<TrendingPerson | undefined> {
    const [person] = await db
      .select()
      .from(trendingPeople)
      .where(eq(trendingPeople.id, id))
      .limit(1);
    
    if (person) {
      return person;
    }
    return this.trendingPeople.get(id);
  }

  async updateTrendingPeople(people: TrendingPerson[]): Promise<void> {
    // SAFEGUARD: Reject mock data writes - THROWS ERROR instead of silent failure
    // Real fame_index values should be in the 100k-600k range (from ingestion)
    // Mock data typically has values in the 5k-10k range
    // Block writes where the average fame_index is suspiciously low
    if (people.length > 0) {
      const avgFameIndex = people.reduce((sum, p) => sum + (p.fameIndex ?? 0), 0) / people.length;
      if (avgFameIndex < 50000) {
        const errorMsg = `[Storage] BLOCKED: Attempted to write mock/corrupted data (avg fameIndex: ${avgFameIndex.toFixed(0)}). Real data should have avg fameIndex > 50,000.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }
    
    // Update in-memory cache
    this.trendingPeople.clear();
    people.forEach((person) => {
      this.trendingPeople.set(person.id, person);
    });
    
    // Batch upsert to database for persistent storage
    const BATCH_SIZE = 50;
    for (let i = 0; i < people.length; i += BATCH_SIZE) {
      const batch = people.slice(i, i + BATCH_SIZE);
      try {
        await db
          .insert(trendingPeople)
          .values(batch.map(person => ({
            id: person.id,
            name: person.name,
            category: canonicalizePersonCategory(person.category) ?? person.category,
            avatar: person.avatar,
            bio: person.bio,
            trendScore: person.trendScore,
            fameIndex: person.fameIndex,
            rank: person.rank,
            change24h: person.change24h,
            change7d: person.change7d,
          })))
          .onConflictDoUpdate({
            target: trendingPeople.id,
            set: {
              trendScore: sql`excluded.trend_score`,
              fameIndex: sql`excluded.fame_index`,
              rank: sql`excluded.rank`,
              change24h: sql`excluded.change_24h`,
              change7d: sql`excluded.change_7d`,
              category: sql`excluded.category`,
            },
          });
      } catch (error) {
        console.error(`[Storage] Error upserting trending people batch ${i}-${i + batch.length}:`, error);
      }
    }
  }

  async getCelebrityProfile(personId: string): Promise<CelebrityProfile | undefined> {
    try {
      const [profile] = await db
        .select()
        .from(celebrityProfiles)
        .where(eq(celebrityProfiles.personId, personId))
        .limit(1);
      return profile;
    } catch (error) {
      if (!isMissingProfileMetadataError(error)) throw error;
      const [profile] = await db
        .select(celebrityProfileBaseColumns)
        .from(celebrityProfiles)
        .where(eq(celebrityProfiles.personId, personId))
        .limit(1);
      return profile ? withFallbackProfileMetadata(profile) : undefined;
    }
  }

  async setCelebrityProfile(profile: InsertCelebrityProfile): Promise<CelebrityProfile> {
    try {
      const [created] = await db
        .insert(celebrityProfiles)
        .values(profile)
        .returning();
      return created;
    } catch (error) {
      if (!isMissingProfileMetadataError(error)) throw error;
      const [created] = await db
        .insert(celebrityProfiles)
        .values(stripProfileMetadata(profile) as InsertCelebrityProfile)
        .returning(celebrityProfileBaseColumns);
      return withFallbackProfileMetadata(created);
    }
  }

  async updateCelebrityProfile(personId: string, profile: Partial<InsertCelebrityProfile>): Promise<CelebrityProfile | undefined> {
    try {
      const [updated] = await db
        .update(celebrityProfiles)
        .set({ ...profile, generatedAt: new Date() })
        .where(eq(celebrityProfiles.personId, personId))
        .returning();
      return updated;
    } catch (error) {
      if (!isMissingProfileMetadataError(error)) throw error;
      const [updated] = await db
        .update(celebrityProfiles)
        .set({ ...stripProfileMetadata(profile), generatedAt: new Date() })
        .where(eq(celebrityProfiles.personId, personId))
        .returning(celebrityProfileBaseColumns);
      return updated ? withFallbackProfileMetadata(updated) : undefined;
    }
  }

  async updateCelebrityProfileFields(
    personId: string,
    fields: Partial<InsertCelebrityProfile>,
  ): Promise<CelebrityProfile | undefined> {
    const { generatedAt: _generatedAt, ...rest } = fields;
    try {
      const [updated] = await db
        .update(celebrityProfiles)
        .set(rest)
        .where(eq(celebrityProfiles.personId, personId))
        .returning();
      return updated;
    } catch (error) {
      if (!isMissingProfileMetadataError(error)) throw error;
      const legacy = stripProfileMetadata(rest as Partial<InsertCelebrityProfile>);
      const [updated] = await db
        .update(celebrityProfiles)
        .set(legacy)
        .where(eq(celebrityProfiles.personId, personId))
        .returning(celebrityProfileBaseColumns);
      return updated ? withFallbackProfileMetadata(updated) : undefined;
    }
  }
}

export const storage = new MemStorage();
