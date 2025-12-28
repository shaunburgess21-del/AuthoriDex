import { type User, type InsertUser, type TrendingPerson } from "@shared/schema";
import { randomUUID } from "crypto";

export interface CelebrityProfile {
  personId: string;
  personName: string;
  shortBio: string;
  knownFor: string;
  fromCountry: string;
  fromCountryCode: string;
  basedIn: string;
  basedInCountryCode: string;
  estimatedNetWorth: string;
  generatedAt: Date;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getTrendingPeople(): Promise<TrendingPerson[]>;
  getTrendingPerson(id: string): Promise<TrendingPerson | undefined>;
  updateTrendingPeople(people: TrendingPerson[]): Promise<void>;
  getCelebrityProfile(personId: string): Promise<CelebrityProfile | undefined>;
  setCelebrityProfile(profile: CelebrityProfile): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private trendingPeople: Map<string, TrendingPerson>;
  private celebrityProfiles: Map<string, CelebrityProfile>;

  constructor() {
    this.users = new Map();
    this.trendingPeople = new Map();
    this.celebrityProfiles = new Map();
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
    return this.celebrityProfiles.get(personId);
  }

  async setCelebrityProfile(profile: CelebrityProfile): Promise<void> {
    this.celebrityProfiles.set(profile.personId, profile);
  }
}

export const storage = new MemStorage();
