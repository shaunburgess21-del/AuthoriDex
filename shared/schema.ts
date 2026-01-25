import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, unique, jsonb, serial, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").unique(),
  walletAddress: text("wallet_address"),
  xpPoints: integer("xp_points").notNull().default(0),
  reputationRank: text("reputation_rank").notNull().default("Citizen"),
  predictCredits: integer("predict_credits").notNull().default(1000),
  currentStreak: integer("current_streak").notNull().default(0),
  lastActiveAt: timestamp("last_active_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Tracked people - the master list of celebrities/influencers we're monitoring
export const trackedPeople = pgTable("tracked_people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  avatar: text("avatar"),
  bio: text("bio"),
  youtubeId: text("youtube_id"),
  spotifyId: text("spotify_id"),
  wikiSlug: text("wiki_slug"),
  xHandle: text("x_handle"),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  status: text("status").notNull().default("main_leaderboard"),
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
  fameIndex: integer("fame_index").default(0), // 0-10,000 normalized score
  wikiPageviews: real("wiki_pageviews").default(0),
  wikiDelta: real("wiki_delta").default(0),
  newsDelta: real("news_delta").default(0),
  searchDelta: real("search_delta").default(0),
  xQuoteVelocity: real("x_quote_velocity").default(0),
  xReplyVelocity: real("x_reply_velocity").default(0),
  massScore: real("mass_score").default(0),
  velocityScore: real("velocity_score").default(0),
  velocityAdjusted: real("velocity_adjusted").default(0), // After anti-spam damping
  confidence: real("confidence").default(1.0),
  diversityMultiplier: real("diversity_multiplier").default(1.0),
  momentum: text("momentum").default("Stable"),
  drivers: text("drivers").array(),
}, (table) => ({
  uniquePersonTimestamp: unique().on(table.personId, table.timestamp),
}));

// API Cache - stores raw API responses to prevent redundant calls
export const apiCache = pgTable("api_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cacheKey: text("cache_key").notNull().unique(),
  provider: text("provider").notNull(),
  personId: varchar("person_id"),
  responseData: text("response_data").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertApiCacheSchema = createInsertSchema(apiCache).omit({
  id: true,
  fetchedAt: true,
});

export type ApiCache = typeof apiCache.$inferSelect;
export type InsertApiCache = z.infer<typeof insertApiCacheSchema>;

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
  fameIndex: integer("fame_index").default(0), // 0-10,000 normalized score (primary UI number)
  change24h: real("change_24h"),
  change7d: real("change_7d"),
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

// Overrated/Underrated sentiment votes - rate limited to 1/user/day (Supabase)
export const sentimentVotes = pgTable("sentiment_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  personId: varchar("person_id").notNull(),
  personName: text("person_name").notNull(),
  voteType: text("vote_type").notNull(), // 'overrated' or 'underrated'
  votedAt: timestamp("voted_at").notNull().defaultNow(),
  votedDate: text("voted_date").notNull(), // YYYY-MM-DD for daily rate limiting
}, (table) => ({
  uniqueUserPersonDate: unique().on(table.userId, table.personId, table.votedDate),
}));

export const insertSentimentVoteSchema = createInsertSchema(sentimentVotes).omit({
  id: true,
  votedAt: true,
});

export type SentimentVote = typeof sentimentVotes.$inferSelect;
export type InsertSentimentVote = z.infer<typeof insertSentimentVoteSchema>;

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

// Community Insights - user-generated insights/posts about tracked people
export const communityInsights = pgTable("community_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull(), // References tracked person
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  username: text("username").notNull(), // Cached for quick display
  content: text("content").notNull(),
  sentimentVote: integer("sentiment_vote"), // Optional 1-10 rating from Cast Your Vote widget
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommunityInsightSchema = createInsertSchema(communityInsights).omit({
  id: true,
  createdAt: true,
});

export type CommunityInsight = typeof communityInsights.$inferSelect;
export type InsertCommunityInsight = z.infer<typeof insertCommunityInsightSchema>;

// Insight Votes - tracks upvotes/downvotes on community insights
export const insightVotes = pgTable("insight_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  insightId: varchar("insight_id").notNull().references(() => communityInsights.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  voteType: text("vote_type").notNull(), // 'up' or 'down'
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserInsight: unique().on(table.userId, table.insightId),
}));

export const insertInsightVoteSchema = createInsertSchema(insightVotes).omit({
  id: true,
  votedAt: true,
});

export type InsightVote = typeof insightVotes.$inferSelect;
export type InsertInsightVote = z.infer<typeof insertInsightVoteSchema>;

// Insight Comments - threaded comments on community insights
export const insightComments = pgTable("insight_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  insightId: varchar("insight_id").notNull().references(() => communityInsights.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id"), // null for top-level comments, references parent comment for replies
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  username: text("username").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInsightCommentSchema = createInsertSchema(insightComments).omit({
  id: true,
  createdAt: true,
});

export type InsightComment = typeof insightComments.$inferSelect;
export type InsertInsightComment = z.infer<typeof insertInsightCommentSchema>;

// Comment Votes - tracks upvotes/downvotes on comments
export const commentVotes = pgTable("comment_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => insightComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  voteType: text("vote_type").notNull(), // 'up' or 'down'
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserComment: unique().on(table.userId, table.commentId),
}));

export const insertCommentVoteSchema = createInsertSchema(commentVotes).omit({
  id: true,
  votedAt: true,
});

export type CommentVote = typeof commentVotes.$inferSelect;
export type InsertCommentVote = z.infer<typeof insertCommentVoteSchema>;

// Celebrity Profiles - AI-generated biographical data with caching
export const celebrityProfiles = pgTable("celebrity_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().unique(),
  personName: text("person_name").notNull(),
  shortBio: text("short_bio").notNull(),
  longBio: text("long_bio"), // Extended bio for "read more"
  knownFor: text("known_for").notNull(),
  fromCountry: text("from_country").notNull(),
  fromCountryCode: varchar("from_country_code", { length: 2 }).notNull(),
  basedIn: text("based_in").notNull(),
  basedInCountryCode: varchar("based_in_country_code", { length: 2 }).notNull(),
  estimatedNetWorth: text("estimated_net_worth").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const insertCelebrityProfileSchema = createInsertSchema(celebrityProfiles).omit({
  id: true,
});

export type CelebrityProfile = typeof celebrityProfiles.$inferSelect;
export type InsertCelebrityProfile = z.infer<typeof insertCelebrityProfileSchema>;

// Ranks - 7-tier reputation system with XP thresholds and vote multipliers
export const ranks = pgTable("ranks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  tier: integer("tier").notNull().unique(),
  minXp: integer("min_xp").notNull(),
  maxXp: integer("max_xp"),
  voteMultiplier: real("vote_multiplier").notNull().default(1.0),
  color: text("color").notNull(),
  icon: text("icon"),
});

export const insertRankSchema = createInsertSchema(ranks).omit({
  id: true,
});

export type Rank = typeof ranks.$inferSelect;
export type InsertRank = z.infer<typeof insertRankSchema>;

// Unified Votes - polymorphic voting table for all vote types
export const votes = pgTable("votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  voteType: text("vote_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: varchar("target_id").notNull(),
  value: text("value").notNull(),
  weight: real("weight").notNull().default(1.0),
  metadata: jsonb("metadata"),
  votedAt: timestamp("voted_at").notNull().defaultNow(),
});

export const insertVoteSchema = createInsertSchema(votes).omit({
  id: true,
  votedAt: true,
});

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

// Induction Candidates - potential new celebrities for community voting
export const inductionCandidates = pgTable("induction_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  avatar: text("avatar"),
  bio: text("bio"),
  wikiSlug: text("wiki_slug"),
  xHandle: text("x_handle"),
  instagramHandle: text("instagram_handle"),
  submittedBy: varchar("submitted_by"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  votesFor: integer("votes_for").notNull().default(0),
  votesAgainst: integer("votes_against").notNull().default(0),
  status: text("status").notNull().default("pending"),
});

export const insertInductionCandidateSchema = createInsertSchema(inductionCandidates).omit({
  id: true,
  submittedAt: true,
  votesFor: true,
  votesAgainst: true,
});

export type InductionCandidate = typeof inductionCandidates.$inferSelect;
export type InsertInductionCandidate = z.infer<typeof insertInductionCandidateSchema>;

// Celebrity Images - multiple photos per celebrity for "Curate Profile" voting
export const celebrityImages = pgTable("celebrity_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  source: text("source"),
  isPrimary: boolean("is_primary").notNull().default(false),
  votesUp: integer("votes_up").notNull().default(0),
  votesDown: integer("votes_down").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertCelebrityImageSchema = createInsertSchema(celebrityImages).omit({
  id: true,
  addedAt: true,
  votesUp: true,
  votesDown: true,
});

export type CelebrityImage = typeof celebrityImages.$inferSelect;
export type InsertCelebrityImage = z.infer<typeof insertCelebrityImageSchema>;

// Face-Offs - A vs B binary choice voting questions
export const faceOffs = pgTable("face_offs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  title: text("title").notNull(),
  optionAText: text("option_a_text").notNull(),
  optionAImage: text("option_a_image"),
  optionBText: text("option_b_text").notNull(),
  optionBImage: text("option_b_image"),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0), // For admin drag-and-drop ordering
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFaceOffSchema = createInsertSchema(faceOffs).omit({
  id: true,
  createdAt: true,
});

export type FaceOff = typeof faceOffs.$inferSelect;
export type InsertFaceOff = z.infer<typeof insertFaceOffSchema>;

// Relations for new tables
export const celebrityImagesRelations = relations(celebrityImages, ({ one }) => ({
  person: one(trackedPeople, {
    fields: [celebrityImages.personId],
    references: [trackedPeople.id],
  }),
}));

// ============================================================================
// GAMIFICATION ECONOMY TABLES (Phase 1)
// ============================================================================

// XP Actions - Data-driven XP values and daily caps (Game Master table)
export const xpActions = pgTable("xp_actions", {
  id: serial("id").primaryKey(),
  actionKey: text("action_key").notNull().unique(), // e.g., 'vote_sentiment', 'vote_face_off', 'post_insight'
  displayName: text("display_name").notNull(),
  xpValue: integer("xp_value").notNull(),
  dailyCap: integer("daily_cap"), // null = unlimited
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: timestamp("effective_date").notNull().defaultNow(),
  expiryDate: timestamp("expiry_date"), // null = never expires
});

export const insertXpActionSchema = createInsertSchema(xpActions).omit({
  id: true,
});

export type XpAction = typeof xpActions.$inferSelect;
export type InsertXpAction = z.infer<typeof insertXpActionSchema>;

// XP Ledger - Immutable transaction log for XP awards (Source of Truth)
export const xpLedger = pgTable("xp_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(), // References xpActions.actionKey
  xpDelta: integer("xp_delta").notNull(), // Can be negative for deductions
  idempotencyKey: text("idempotency_key").notNull(), // Prevents duplicate awards
  source: text("source").notNull().default("user_action"), // 'user_action', 'legacy_migration', 'admin_adjustment'
  metadata: jsonb("metadata"), // Flexible: { targetId, targetType, ip_address, device_id, etc. }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueIdempotency: unique().on(table.userId, table.idempotencyKey),
}));

export const insertXpLedgerSchema = createInsertSchema(xpLedger).omit({
  id: true,
  createdAt: true,
});

export type XpLedger = typeof xpLedger.$inferSelect;
export type InsertXpLedger = z.infer<typeof insertXpLedgerSchema>;

// Credit Ledger - Immutable transaction log for virtual/real credits (Source of Truth)
export const creditLedger = pgTable("credit_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  txnType: text("txn_type").notNull(), // 'prediction_stake', 'prediction_payout', 'bonus', 'admin_adjustment'
  amount: integer("amount").notNull(), // Positive = credit, Negative = debit
  walletType: text("wallet_type").notNull().default("VIRTUAL"), // 'VIRTUAL' (Phase 1), 'REAL' (Phase 2)
  balanceAfter: integer("balance_after").notNull(), // Snapshot for audit
  source: text("source").notNull().default("user_action"),
  complianceStatus: text("compliance_status").default("pending"), // For future Phase 2
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata"), // { predictionId, ip_address, device_id, etc. }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueIdempotency: unique().on(table.userId, table.idempotencyKey),
}));

export const insertCreditLedgerSchema = createInsertSchema(creditLedger).omit({
  id: true,
  createdAt: true,
});

export type CreditLedger = typeof creditLedger.$inferSelect;
export type InsertCreditLedger = z.infer<typeof insertCreditLedgerSchema>;

// User Profiles - linked to Supabase Auth, stores profile info and role
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey(), // Supabase Auth user ID (not auto-generated)
  username: text("username").unique(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  isPublic: boolean("is_public").notNull().default(true),
  role: text("role").notNull().default("user"), // 'user', 'admin', 'moderator'
  rank: text("rank").notNull().default("Citizen"), // From ranks table: Citizen, Verified, etc.
  xpPoints: integer("xp_points").notNull().default(0),
  predictCredits: integer("predict_credits").notNull().default(1000),
  currentStreak: integer("current_streak").notNull().default(0),
  totalVotes: integer("total_votes").notNull().default(0),
  totalPredictions: integer("total_predictions").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  lastActiveAt: timestamp("last_active_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({
  createdAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

// Relations for gamification tables
export const xpLedgerRelations = relations(xpLedger, ({ one }) => ({
  user: one(users, {
    fields: [xpLedger.userId],
    references: [users.id],
  }),
}));

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(users, {
    fields: [creditLedger.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  xpLedgerEntries: many(xpLedger),
  creditLedgerEntries: many(creditLedger),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  votes: many(votes),
}));

// ============================================================================
// PREDICTION MARKETS TABLES (Admin Dashboard)
// ============================================================================

// Prediction Markets - Core table for all prediction market types
export const predictionMarkets = pgTable("prediction_markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketType: text("market_type").notNull(), // 'jackpot', 'updown', 'h2h', 'race', 'gainer', 'community'
  status: text("status").notNull().default("OPEN"), // 'OPEN', 'CLOSED_PENDING', 'RESOLVED', 'VOID'
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  summary: text("summary"),
  rules: text("rules"),
  metadata: jsonb("metadata"), // Flexible: { threshold, metric, jackpotRules, etc. }
  startAt: timestamp("start_at").notNull().defaultNow(),
  endAt: timestamp("end_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  voidReason: text("void_reason"),
  createdBy: varchar("created_by"), // Admin who created it
  settledBy: varchar("settled_by"), // Admin who settled it
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPredictionMarketSchema = createInsertSchema(predictionMarkets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PredictionMarket = typeof predictionMarkets.$inferSelect;
export type InsertPredictionMarket = z.infer<typeof insertPredictionMarketSchema>;

// Market Entries - Options/candidates within a market
export const marketEntries = pgTable("market_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
  entryType: text("entry_type").notNull().default("custom"), // 'person' (linked to tracked_people) or 'custom'
  personId: varchar("person_id").references(() => trackedPeople.id), // Nullable - for celebrity-based entries
  label: text("label").notNull(), // Display name (snapshotted for non-person entries)
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  totalStake: integer("total_stake").notNull().default(0), // Total credits staked on this entry
  resolutionStatus: text("resolution_status").notNull().default("pending"), // 'pending', 'winner', 'loser', 'void'
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMarketEntrySchema = createInsertSchema(marketEntries).omit({
  id: true,
  createdAt: true,
  totalStake: true,
});

export type MarketEntry = typeof marketEntries.$inferSelect;
export type InsertMarketEntry = z.infer<typeof insertMarketEntrySchema>;

// Market Bets - User stakes on market entries
export const marketBets = pgTable("market_bets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
  entryId: varchar("entry_id").notNull().references(() => marketEntries.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  stakeAmount: integer("stake_amount").notNull(),
  potentialPayout: integer("potential_payout"), // Calculated at bet time
  status: text("status").notNull().default("active"), // 'active', 'won', 'lost', 'void', 'refunded'
  settledAt: timestamp("settled_at"),
  payoutAmount: integer("payout_amount"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMarketBetSchema = createInsertSchema(marketBets).omit({
  id: true,
  createdAt: true,
  settledAt: true,
  payoutAmount: true,
});

export type MarketBet = typeof marketBets.$inferSelect;
export type InsertMarketBet = z.infer<typeof insertMarketBetSchema>;

// Relations for prediction markets
export const predictionMarketsRelations = relations(predictionMarkets, ({ many }) => ({
  entries: many(marketEntries),
  bets: many(marketBets),
}));

export const marketEntriesRelations = relations(marketEntries, ({ one, many }) => ({
  market: one(predictionMarkets, {
    fields: [marketEntries.marketId],
    references: [predictionMarkets.id],
  }),
  person: one(trackedPeople, {
    fields: [marketEntries.personId],
    references: [trackedPeople.id],
  }),
  bets: many(marketBets),
}));

export const marketBetsRelations = relations(marketBets, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketBets.marketId],
    references: [predictionMarkets.id],
  }),
  entry: one(marketEntries, {
    fields: [marketBets.entryId],
    references: [marketEntries.id],
  }),
}));

// ============================================================================
// ADMIN AUDIT LOG (Immutable)
// ============================================================================

// Admin Audit Log - Immutable record of all admin actions
export const adminAuditLog = pgTable("admin_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(), // References profiles.id
  adminEmail: text("admin_email"), // Cached for quick display
  actionType: text("action_type").notNull(), // 'ban_user', 'adjust_credits', 'resolve_market', 'create_market', etc.
  targetTable: text("target_table").notNull(), // 'users', 'prediction_markets', 'face_offs', etc.
  targetId: varchar("target_id").notNull(),
  previousData: jsonb("previous_data"), // Snapshot before change
  newData: jsonb("new_data"), // Snapshot after change
  metadata: jsonb("metadata"), // Additional context: { reason, ip_address, user_agent, etc. }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLog).omit({
  id: true,
  createdAt: true,
});

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;

// ============================================================================
// PAGE VIEWS - Traffic Analytics
// ============================================================================

// Page Views - Tracks website traffic for analytics
export const pageViews = pgTable("page_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  path: text("path").notNull(), // The URL path visited
  userAgent: text("user_agent"), // Browser/device info
  referrer: text("referrer"), // Where they came from
  sessionId: text("session_id"), // Anonymous session tracking
  userId: varchar("user_id"), // Optional: logged-in user
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("page_views_created_at_idx").on(table.createdAt),
  pathIdx: index("page_views_path_idx").on(table.path),
}));

export const insertPageViewSchema = createInsertSchema(pageViews).omit({
  id: true,
  createdAt: true,
});

export type PageView = typeof pageViews.$inferSelect;
export type InsertPageView = z.infer<typeof insertPageViewSchema>;

// ============================================================================
// PLATFORM STATUS - Tracks data source availability per celebrity
// ============================================================================

// Platform status values:
// - ACTIVE: Platform exists and we're tracking it
// - NOT_PRESENT: Celebrity doesn't have this platform (penalize)
// - NOT_APPLICABLE: Platform doesn't apply (e.g., Spotify for politicians - no penalty)
// - TEMP_FAIL: API failure - fill-forward, don't penalize
export type PlatformStatusValue = "ACTIVE" | "NOT_PRESENT" | "NOT_APPLICABLE" | "TEMP_FAIL";

export const platformStatus = pgTable("platform_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // wiki, x, instagram, youtube, tiktok, spotify, news, search
  status: text("status").notNull().default("ACTIVE"), // ACTIVE, NOT_PRESENT, NOT_APPLICABLE, TEMP_FAIL
  lastValue: real("last_value"), // Last known good value for fill-forward
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  stalenessHours: integer("staleness_hours").default(0),
}, (table) => ({
  uniquePersonPlatform: unique().on(table.personId, table.platform),
}));

export const insertPlatformStatusSchema = createInsertSchema(platformStatus).omit({
  id: true,
});

export type PlatformStatus = typeof platformStatus.$inferSelect;
export type InsertPlatformStatus = z.infer<typeof insertPlatformStatusSchema>;

// ============================================================================
// CELEBRITY METRICS - Aggregated voting data for fast leaderboard sorting
// ============================================================================

// Celebrity Metrics - 1 row per celebrity for fast leaderboard queries
export const celebrityMetrics = pgTable("celebrity_metrics", {
  celebrityId: varchar("celebrity_id").primaryKey().references(() => trackedPeople.id, { onDelete: "cascade" }),
  // Fame Index score (mirrors trend_score from trending_people)
  trendScore: real("trend_score").default(0),
  fameIndex: integer("fame_index").default(0),
  // Approval aggregates (from user_votes table)
  approvalVotesCount: integer("approval_votes_count").notNull().default(0),
  approvalAvgRating: real("approval_avg_rating"), // 1-5 scale
  approvalPct: real("approval_pct"), // 0-100 scale ((avg_rating - 1) / 4 * 100)
  // Value aggregates (from celebrity_value_votes table)
  underratedVotesCount: integer("underrated_votes_count").notNull().default(0),
  overratedVotesCount: integer("overrated_votes_count").notNull().default(0),
  underratedPct: real("underrated_pct"), // 0-100
  overratedPct: real("overrated_pct"), // 0-100
  valueScore: real("value_score"), // -100 to +100 (underrated_pct - overrated_pct)
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCelebrityMetricsSchema = createInsertSchema(celebrityMetrics);

export type CelebrityMetrics = typeof celebrityMetrics.$inferSelect;
export type InsertCelebrityMetrics = z.infer<typeof insertCelebrityMetricsSchema>;

// Celebrity Value Votes - underrated/overrated votes (1 per user per celebrity)
export const celebrityValueVotes = pgTable("celebrity_value_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  celebrityId: varchar("celebrity_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  vote: text("vote").notNull(), // 'underrated' or 'overrated'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserCelebrity: unique().on(table.userId, table.celebrityId),
  celebrityIdx: index("celebrity_value_votes_celebrity_idx").on(table.celebrityId),
  userIdx: index("celebrity_value_votes_user_idx").on(table.userId),
}));

export const insertCelebrityValueVoteSchema = createInsertSchema(celebrityValueVotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CelebrityValueVote = typeof celebrityValueVotes.$inferSelect;
export type InsertCelebrityValueVote = z.infer<typeof insertCelebrityValueVoteSchema>;

// ============================================================================
// TIER-1 OVERRIDES - Manual corrections for top celebrities
// ============================================================================

// Tier-1 Overrides - Manual follower/metric overrides for top celebrities
export const tier1Overrides = pgTable("tier1_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }).unique(),
  xFollowers: real("x_followers"), // Override X/Twitter follower count
  instagramFollowers: real("instagram_followers"),
  youtubeSubscribers: real("youtube_subscribers"),
  tiktokFollowers: real("tiktok_followers"),
  spotifyMonthlyListeners: real("spotify_monthly_listeners"),
  notes: text("notes"), // Admin notes about why override is needed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTier1OverrideSchema = createInsertSchema(tier1Overrides).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Tier1Override = typeof tier1Overrides.$inferSelect;
export type InsertTier1Override = z.infer<typeof insertTier1OverrideSchema>;
