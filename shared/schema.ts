import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

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

// Tracked people - the master list of celebrities/influencers we're monitoring
export const trackedPeople = pgTable("tracked_people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  avatar: text("avatar"),
  bio: text("bio"),
  youtubeId: text("youtube_id"),
  spotifyId: text("spotify_id"),
});

export const insertTrackedPersonSchema = createInsertSchema(trackedPeople).omit({
  id: true,
});

export type TrackedPerson = typeof trackedPeople.$inferSelect;
export type InsertTrackedPerson = z.infer<typeof insertTrackedPersonSchema>;

// Trend snapshots - historical time-series data for each person
export const trendSnapshots = pgTable("trend_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  newsCount: real("news_count").notNull().default(0),
  youtubeViews: real("youtube_views").notNull().default(0),
  spotifyFollowers: real("spotify_followers").notNull().default(0),
  searchVolume: real("search_volume").notNull().default(0),
  trendScore: real("trend_score").notNull(),
}, (table) => ({
  uniquePersonTimestamp: unique().on(table.personId, table.timestamp),
}));

export const insertTrendSnapshotSchema = createInsertSchema(trendSnapshots).omit({
  id: true,
  timestamp: true,
});

export type TrendSnapshot = typeof trendSnapshots.$inferSelect;
export type InsertTrendSnapshot = z.infer<typeof insertTrendSnapshotSchema>;

// Relations
export const trackedPeopleRelations = relations(trackedPeople, ({ many }) => ({
  snapshots: many(trendSnapshots),
}));

export const trendSnapshotsRelations = relations(trendSnapshots, ({ one }) => ({
  person: one(trackedPeople, {
    fields: [trendSnapshots.personId],
    references: [trackedPeople.id],
  }),
}));

// Legacy trending people table (for backwards compatibility with existing API)
export const trendingPeople = pgTable("trending_people", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  bio: text("bio"),
  rank: integer("rank").notNull(),
  trendScore: real("trend_score").notNull(),
  change24h: real("change_24h").notNull(),
  change7d: real("change_7d").notNull(),
  category: text("category"),
});

export type TrendingPerson = typeof trendingPeople.$inferSelect;

// Platform Insights - platform-specific content insights for each person
export const platformInsights = pgTable("platform_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // X, YouTube, Instagram, TikTok, Spotify, News
  insightType: text("insight_type").notNull(), // Most Liked Tweet, Top Video, etc.
  metricName: text("metric_name").notNull(), // likes, views, plays, etc.
});

export const insertPlatformInsightSchema = createInsertSchema(platformInsights).omit({
  id: true,
});

export type PlatformInsight = typeof platformInsights.$inferSelect;
export type InsertPlatformInsight = z.infer<typeof insertPlatformInsightSchema>;

// Insight Items - top 5 ranked items for each insight
export const insightItems = pgTable("insight_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  insightId: varchar("insight_id").notNull().references(() => platformInsights.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(), // 1-5
  title: text("title").notNull(),
  metricValue: real("metric_value").notNull(),
  link: text("link"), // optional URL
  imageUrl: text("image_url"), // optional thumbnail
  timestamp: timestamp("timestamp"), // when it was posted
});

export const insertInsightItemSchema = createInsertSchema(insightItems).omit({
  id: true,
});

export type InsightItem = typeof insightItems.$inferSelect;
export type InsertInsightItem = z.infer<typeof insertInsightItemSchema>;

// Relations for platform insights
export const platformInsightsRelations = relations(platformInsights, ({ one, many }) => ({
  person: one(trackedPeople, {
    fields: [platformInsights.personId],
    references: [trackedPeople.id],
  }),
  items: many(insightItems),
}));

export const insightItemsRelations = relations(insightItems, ({ one }) => ({
  insight: one(platformInsights, {
    fields: [insightItems.insightId],
    references: [platformInsights.id],
  }),
}));

// User votes - stores user sentiment ratings for tracked people (Supabase)
export const userVotes = pgTable("user_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  personId: varchar("person_id").notNull(), // References tracked person
  personName: text("person_name").notNull(), // Cached for quick display
  rating: integer("rating").notNull(), // 1-10 sentiment score
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPerson: unique().on(table.userId, table.personId),
}));

export const insertUserVoteSchema = createInsertSchema(userVotes).omit({
  id: true,
  votedAt: true,
});

export type UserVote = typeof userVotes.$inferSelect;
export type InsertUserVote = z.infer<typeof insertUserVoteSchema>;

// User favourites - stores which people a user has favourited (Supabase)
export const userFavourites = pgTable("user_favourites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  personId: varchar("person_id").notNull(), // References tracked person
  personName: text("person_name").notNull(), // Cached for quick display
  personAvatar: text("person_avatar"), // Cached for quick display
  personCategory: text("person_category"), // Cached for quick display
  favouritedAt: timestamp("favourited_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPerson: unique().on(table.userId, table.personId),
}));

export const insertUserFavouriteSchema = createInsertSchema(userFavourites).omit({
  id: true,
  favouritedAt: true,
});

export type UserFavourite = typeof userFavourites.$inferSelect;
export type InsertUserFavourite = z.infer<typeof insertUserFavouriteSchema>;
