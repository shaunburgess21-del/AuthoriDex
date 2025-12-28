import { type User, type InsertUser, type TrendingPerson, type CelebrityProfile, type InsertCelebrityProfile, celebrityProfiles } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq } from "drizzle-orm";

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
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getTrendingPeople(): Promise<TrendingPerson[]> {
    return Array.from(this.trendingPeople.values());
  }

  async getTrendingPerson(id: string): Promise<TrendingPerson | undefined> {
    return this.trendingPeople.get(id);
  }

  async updateTrendingPeople(people: TrendingPerson[]): Promise<void> {
    this.trendingPeople.clear();
    people.forEach((person) => {
      this.trendingPeople.set(person.id, person);
    });
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
