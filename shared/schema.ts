import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const trendingPeople = pgTable("trending_people", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  rank: integer("rank").notNull(),
  trendScore: real("trend_score").notNull(),
  change24h: real("change_24h").notNull(),
  change7d: real("change_7d").notNull(),
  category: text("category"),
});

export type TrendingPerson = typeof trendingPeople.$inferSelect;
