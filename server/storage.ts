import { type User, type InsertUser, type TrendingPerson, type CelebrityProfile, type InsertCelebrityProfile, celebrityProfiles, trendingPeople } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, asc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getTrendingPeople(): Promise<TrendingPerson[]>;
  getTrendingPerson(id: string): Promise<TrendingPerson | undefined>;
  updateTrendingPeople(people: TrendingPerson[]): Promise<void>;
  getCelebrityProfile(personId: string): Promise<CelebrityProfile | undefined>;
  setCelebrityProfile(profile: InsertCelebrityProfile): Promise<CelebrityProfile>;
  updateCelebrityProfile(personId: string, profile: Partial<InsertCelebrityProfile>): Promise<CelebrityProfile | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private trendingPeople: Map<string, TrendingPerson>;

  constructor() {
    this.users = new Map();
    this.trendingPeople = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      walletAddress: null,
      email: null,
      xpPoints: 0,
      reputationRank: "Citizen",
      predictCredits: 1000,
      currentStreak: 0,
      lastActiveAt: null,
      createdAt: new Date(),
      ...insertUser,
      id,
    };
    this.users.set(id, user);
    return user;
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
    
    // Upsert to database for persistent storage
    for (const person of people) {
      try {
        await db
          .insert(trendingPeople)
          .values({
            id: person.id,
            name: person.name,
            category: person.category,
            avatar: person.avatar,
            bio: person.bio,
            trendScore: person.trendScore,
            fameIndex: person.fameIndex,
            rank: person.rank,
            change24h: person.change24h,
            change7d: person.change7d,
          })
          .onConflictDoUpdate({
            target: trendingPeople.id,
            set: {
              trendScore: person.trendScore,
              fameIndex: person.fameIndex,
              rank: person.rank,
              change24h: person.change24h,
              change7d: person.change7d,
            },
          });
      } catch (error) {
        console.error(`[Storage] Error upserting trending person ${person.name}:`, error);
      }
    }
  }

  async getCelebrityProfile(personId: string): Promise<CelebrityProfile | undefined> {
    const [profile] = await db
      .select()
      .from(celebrityProfiles)
      .where(eq(celebrityProfiles.personId, personId))
      .limit(1);
    return profile;
  }

  async setCelebrityProfile(profile: InsertCelebrityProfile): Promise<CelebrityProfile> {
    const [created] = await db
      .insert(celebrityProfiles)
      .values(profile)
      .returning();
    return created;
  }

  async updateCelebrityProfile(personId: string, profile: Partial<InsertCelebrityProfile>): Promise<CelebrityProfile | undefined> {
    const [updated] = await db
      .update(celebrityProfiles)
      .set({ ...profile, generatedAt: new Date() })
      .where(eq(celebrityProfiles.personId, personId))
      .returning();
    return updated;
  }
}

export const storage = new MemStorage();
