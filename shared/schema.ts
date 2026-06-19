import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, integer, real, timestamp, unique, uniqueIndex, jsonb, serial, boolean, index, numeric, check, primaryKey, date, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// SECURITY NOTE:
// Any new table in exposed schemas (especially public) must ship with a
// migration that enables RLS. User-owned tables queried from the frontend via
// the anon client also need owner policies (e.g., auth.uid()::text = user_id).
export const contentStatusEnum = pgEnum("content_status", ["draft", "live", "archived"]);
export const marketOutcomeEnum = pgEnum("market_outcome", ["yes", "no"]);
export const commentParentTypeEnum = pgEnum("comment_parent_type", [
  "community_insight",
  "matchup",
  "trending_poll",
  "opinion_poll",
  "open_market",
]);
export const commentVoteTypeEnum = pgEnum("comment_vote_type", ["up", "down"]);

// NOTE: Auth and live account state are handled via Supabase + profiles.
// The legacy users table is kept only for migration-era compatibility and should not be used for runtime reads/writes.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  // Note: the legacy `password` column was dropped in migration 0012. Auth is
  // handled exclusively by Supabase via the `profiles` table.
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
  imageSlug: text("image_slug"),
  bio: text("bio"),
  youtubeId: text("youtube_id"),
  spotifyId: text("spotify_id"),
  wikiSlug: text("wiki_slug"),
  xHandle: text("x_handle"),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  searchQueryOverride: text("search_query_override"),
  newsQueryWidened: text("news_query_widened"),
  googleTrendsTopicId: text("google_trends_topic_id"),
  status: text("status").notNull().default("main_leaderboard"),
}, (table) => ({
  statusIdx: index("tracked_people_status_idx").on(table.status),
}));

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
  fameIndex: integer("fame_index").default(0), // canonical hourly Fame Index (~100k–800k scale)
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
  snapshotOrigin: text("snapshot_origin").default("ingest"),
  diagnostics: jsonb("diagnostics"),
  runId: varchar("run_id").notNull(),
  scoreVersion: varchar("score_version").default("v1"),
}, (table) => ({
  uniquePersonTimestamp: unique().on(table.personId, table.timestamp),
  runIdIdx: index("trend_snapshots_run_id_idx").on(table.runId),
  personTsIdx: index("trend_snapshots_person_ts_idx").on(table.personId, table.timestamp),
  personOriginTsIdx: index("trend_snapshots_person_origin_ts_idx").on(table.personId, table.snapshotOrigin, table.timestamp),
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
}, (table) => ({
  providerIdx: index("api_cache_provider_idx").on(table.provider),
}));

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
  fameIndex: integer("fame_index").default(0), // canonical hourly score (primary UI number, ~100k–800k)
  fameIndexLive: integer("fame_index_live"), // mirrors fame_index; freshness heartbeat only
  liveRank: integer("live_rank"), // mirrors rank; cosmetic lane only
  liveUpdatedAt: timestamp("live_updated_at"), // when cosmetic fast-lane last ticked
  liveDampen: real("live_dampen").default(1.0), // legacy; kept at 1.0 in cosmetic lane
  change24h: real("change_24h"),
  change7d: real("change_7d"),
  category: text("category"),
  profileViews10m: integer("profile_views_10m").default(0), // view counter reset each tick
}, (table) => ({
  rankIdx: index("trending_people_rank_idx").on(table.rank),
  categoryIdx: index("trending_people_category_idx").on(table.category),
}));

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
  // FK added in migration 0013 (NOT VALID → needs VALIDATE after orphan cleanup)
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  personName: text("person_name").notNull(), // Cached for quick display
  rating: integer("rating").notNull(), // 1-10 sentiment score
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPerson: unique().on(table.userId, table.personId),
  /** Speeds up approval breakdowns, sentiment stats, and GROUP BY person_id */
  personIdIdx: index("user_votes_person_id_idx").on(table.personId),
  /** Speeds up GROUP BY (person_id, rating) aggregates */
  personRatingIdx: index("user_votes_person_rating_idx").on(table.personId, table.rating),
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
  personIdx: index("sentiment_votes_person_idx").on(table.personId),
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
  // FK added in migration 0013 (NOT VALID → needs VALIDATE after orphan cleanup)
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth user ID — author info resolved live via LEFT JOIN profiles
  content: text("content").notNull(),
  sentimentVote: integer("sentiment_vote"), // Optional 1-10 rating from Cast Your Vote widget
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommunityInsightSchema = createInsertSchema(communityInsights).omit({
  id: true,
  deletedAt: true,
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

// Unified Comments - discussion threads across content surfaces
export const comments = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentType: commentParentTypeEnum("parent_type").notNull(),
  parentId: varchar("parent_id").notNull(),
  parentCommentId: varchar("parent_comment_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  body: text("body").notNull(),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  parentIdx: index("comments_parent_idx").on(table.parentType, table.parentId),
  parentCommentIdx: index("comments_parent_comment_idx").on(table.parentCommentId),
}));

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  upvotes: true,
  downvotes: true,
  deletedAt: true,
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;

// Comment Votes - tracks upvotes/downvotes on unified comments
export const commentVotes = pgTable("comment_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth user ID
  voteType: commentVoteTypeEnum("vote_type").notNull(),
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserComment: unique("comment_votes_user_comment_unique").on(table.userId, table.commentId),
  commentIdx: index("comment_votes_comment_idx").on(table.commentId),
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
  // FK added in migration 0013 (NOT VALID → needs VALIDATE after orphan cleanup)
  personId: varchar("person_id").notNull().unique().references(() => trackedPeople.id, { onDelete: "cascade" }),
  personName: text("person_name").notNull(),
  shortBio: text("short_bio").notNull(),
  longBio: text("long_bio"), // Extended bio for "read more"
  knownFor: text("known_for").notNull(),
  fromCountry: text("from_country").notNull(),
  fromCountryCode: varchar("from_country_code", { length: 2 }).notNull(),
  basedIn: text("based_in").notNull(),
  basedInCountryCode: varchar("based_in_country_code", { length: 2 }).notNull(),
  estimatedNetWorth: text("estimated_net_worth").notNull(),
  promptVersion: integer("prompt_version").notNull().default(1),
  sourceHash: text("source_hash"),
  sourceUrls: text("source_urls").array(),
  confidence: real("confidence"),
  asOfDate: text("as_of_date"),
  validationNotes: text("validation_notes").array(),
  netWorthUpdatedAt: timestamp("net_worth_updated_at"),
  netWorthVolatility: text("net_worth_volatility").notNull().default("standard"), // 'standard' | 'high'
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const insertCelebrityProfileSchema = createInsertSchema(celebrityProfiles).omit({
  id: true,
});

export type CelebrityProfile = typeof celebrityProfiles.$inferSelect;
export type InsertCelebrityProfile = z.infer<typeof insertCelebrityProfileSchema>;

// Ranks - 8-tier reputation system with XP thresholds and vote multipliers
export const ranks = pgTable("ranks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  tier: integer("tier").notNull().unique(),
  minXp: integer("min_xp").notNull(),
  maxXp: integer("max_xp"),
  voteMultiplier: real("vote_multiplier").notNull().default(1.0),
  // Per-tier earn-rate multiplier applied to XP + credit awards at the
  // gamificationService chokepoints (awardXp / adjustCredits). Distinct
  // from curatorialWeight. 1.0 = no boost.
  earnMultiplier: real("earn_multiplier").notNull().default(1.0),
  color: text("color").notNull(),
  icon: text("icon"),
  description: text("description"),
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
}, (table) => ({
  userTargetUniq: unique("votes_user_target_uniq").on(table.userId, table.voteType, table.targetType, table.targetId),
  targetIdx: index("votes_target_idx").on(table.targetType, table.targetId),
}));

export const insertVoteSchema = createInsertSchema(votes).omit({
  id: true,
  votedAt: true,
});

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

// Vote Actions - append-only ledger for every vote mutation/create/edit/remove.
export const voteActions = pgTable("vote_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  voteType: text("vote_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: varchar("target_id").notNull(),
  actionKind: text("action_kind").notNull(), // 'create' | 'update' | 'remove'
  prevValue: text("prev_value"),
  nextValue: text("next_value"),
  source: text("source").notNull().default("unknown"),
  requestId: text("request_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userCreatedIdx: index("vote_actions_user_created_idx").on(table.userId, table.createdAt),
  voteTypeCreatedIdx: index("vote_actions_type_created_idx").on(table.voteType, table.createdAt),
  targetCreatedIdx: index("vote_actions_target_created_idx").on(table.targetType, table.targetId, table.createdAt),
}));

export const insertVoteActionSchema = createInsertSchema(voteActions).omit({
  id: true,
  createdAt: true,
});

export type VoteAction = typeof voteActions.$inferSelect;
export type InsertVoteAction = z.infer<typeof insertVoteActionSchema>;

// Induction Candidates - potential new celebrities for community voting
export const inductionCandidates = pgTable("induction_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  imageSlug: text("image_slug"),
  seedVotes: integer("seed_votes").notNull().default(0),
  wikiSlug: text("wiki_slug"),
  xHandle: text("x_handle"),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  youtubeId: text("youtube_id"),
  spotifyId: text("spotify_id"),
  searchQueryOverride: text("search_query_override"),
  googleTrendsTopicId: text("google_trends_topic_id"),
  inductionStatus: text("induction_status").notNull().default("Queue"),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertInductionCandidateSchema = createInsertSchema(inductionCandidates).omit({
  id: true,
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
}, (table) => ({
  personIdx: index("celebrity_images_person_idx").on(table.personId),
}));

export const insertCelebrityImageSchema = createInsertSchema(celebrityImages).omit({
  id: true,
  addedAt: true,
  votesUp: true,
  votesDown: true,
});

export type CelebrityImage = typeof celebrityImages.$inferSelect;
export type InsertCelebrityImage = z.infer<typeof insertCelebrityImageSchema>;

// Image Votes - deduplication table for curate profile image voting
export const imageVotes = pgTable("image_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  imageId: varchar("image_id").notNull().references(() => celebrityImages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  direction: text("direction").notNull(),
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  userImageUnique: unique("image_votes_user_image_uniq").on(table.userId, table.imageId),
  directionCheck: check("image_votes_direction_check", sql`${table.direction} IN ('up')`),
}));

// Image Flags - user reports for bad celebrity images (schema foundation; UI TBD)
export const imageFlags = pgTable("image_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  imageId: varchar("image_id").notNull().references(() => celebrityImages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: varchar("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  imageUserUnique: unique("image_flags_image_user_uniq").on(table.imageId, table.userId),
  reasonCheck: check(
    "image_flags_reason_check",
    sql`${table.reason} IN ('wrong_person','low_quality','inappropriate','duplicate','other')`,
  ),
  resolvedCreatedIdx: index("image_flags_resolved_created_idx").on(table.resolved, table.createdAt),
}));

export const insertImageFlagSchema = createInsertSchema(imageFlags).omit({
  id: true,
  resolved: true,
  resolvedBy: true,
  resolvedAt: true,
  createdAt: true,
});

export type ImageFlag = typeof imageFlags.$inferSelect;
export type InsertImageFlag = z.infer<typeof insertImageFlagSchema>;

// Induction Votes - deduplication table for induction candidate voting
export const inductionVotes = pgTable("induction_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  candidateId: varchar("candidate_id").notNull().references(() => inductionCandidates.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  votedAt: timestamp("voted_at").notNull().defaultNow(),
}, (table) => ({
  userCandidateUnique: unique("induction_votes_user_candidate_uniq").on(table.userId, table.candidateId),
}));

export const inductionCycleResults = pgTable("induction_cycle_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  weekCloseAt: timestamp("week_close_at").notNull().unique(),
  status: text("status").notNull(),
  candidateId: varchar("candidate_id").references(() => inductionCandidates.id, { onDelete: "set null" }),
  personId: varchar("person_id").references(() => trackedPeople.id, { onDelete: "set null" }),
  voteTotalAtClose: integer("vote_total_at_close"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
}, (table) => ({
  weekCloseAtIdx: index("induction_cycle_results_week_close_at_idx").on(table.weekCloseAt),
}));

// Matchups - A vs B binary choice voting questions
export const matchups = pgTable("face_offs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  title: text("title").notNull(),
  optionAText: text("option_a_text").notNull(),
  optionAImage: text("option_a_image"),
  optionBText: text("option_b_text").notNull(),
  optionBImage: text("option_b_image"),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  status: text("status").notNull().default("draft"),
  personAId: varchar("person_a_id").references(() => trackedPeople.id, { onDelete: "set null" }),
  personBId: varchar("person_b_id").references(() => trackedPeople.id, { onDelete: "set null" }),
  promptText: text("prompt_text"),
  description: text("description"),
  seedVotesA: integer("seed_votes_a").notNull().default(0),
  seedVotesB: integer("seed_votes_b").notNull().default(0),
  seedVotesNeutral: integer("seed_votes_neutral").notNull().default(0),
  visibility: text("visibility").default("live"),
  featured: boolean("featured").default(false),
  slug: text("slug"),
  scheduledAt: timestamp("scheduled_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  slugUniqueIdx: uniqueIndex("face_offs_slug_unique").on(table.slug),
  slugIdx: index("face_offs_slug_idx").on(table.slug),
  visibilityIdx: index("face_offs_visibility_idx").on(table.visibility),
}));

export const insertMatchupSchema = createInsertSchema(matchups).omit({
  id: true,
  createdAt: true,
});

export type Matchup = typeof matchups.$inferSelect;
export type InsertMatchup = z.infer<typeof insertMatchupSchema>;

export const matchupVotes = pgTable("face_off_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchupId: varchar("face_off_id").notNull().references(() => matchups.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  choice: text("choice").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserMatchup: unique("face_off_votes_user_id_face_off_id_unique").on(table.userId, table.matchupId),
}));

export const insertMatchupVoteSchema = createInsertSchema(matchupVotes).omit({
  id: true,
  createdAt: true,
});

export type MatchupVote = typeof matchupVotes.$inferSelect;
export type InsertMatchupVote = z.infer<typeof insertMatchupVoteSchema>;

// ============================================================================
// TRENDING POLLS (Phase 1C) — "People's Voice" / Community Polls
// ============================================================================

export const trendingPolls = pgTable("trending_polls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: contentStatusEnum("status").notNull().default("draft"),
  category: text("category").notNull(),
  headline: text("headline").notNull(),
  subjectText: text("subject_text").notNull(),
  personId: varchar("person_id").references(() => trackedPeople.id),
  description: text("description"),
  timeline: text("timeline"),
  deadlineAt: timestamp("deadline_at"),
  imageUrl: text("image_url"),
  seedSupportCount: integer("seed_support_count").notNull().default(0),
  seedNeutralCount: integer("seed_neutral_count").notNull().default(0),
  seedOpposeCount: integer("seed_oppose_count").notNull().default(0),
  slug: text("slug"),
  featured: boolean("featured").default(false),
  visibility: text("visibility").default("draft"),
  displayOrder: integer("display_order").notNull().default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  slugUniqueIdx: uniqueIndex("trending_polls_slug_unique").on(table.slug),
  statusIdx: index("trending_polls_status_idx").on(table.status),
  slugIdx: index("trending_polls_slug_idx").on(table.slug),
  categoryIdx: index("trending_polls_category_idx").on(table.category),
  personIdIdx: index("trending_polls_person_id_idx").on(table.personId),
  deadlineAtIdx: index("trending_polls_deadline_at_idx").on(table.deadlineAt),
}));

export const insertTrendingPollSchema = createInsertSchema(trendingPolls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TrendingPoll = typeof trendingPolls.$inferSelect;
export type InsertTrendingPoll = z.infer<typeof insertTrendingPollSchema>;

// ============================================================================
// TRENDING POLL VOTES (Phase 1D) — Real user votes only (no seed rows)
// ============================================================================

export const trendingPollVotes = pgTable("trending_poll_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull().references(() => trendingPolls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  choice: text("choice").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPoll: unique("trending_poll_votes_user_id_poll_id_unique").on(table.userId, table.pollId),
  pollIdIdx: index("trending_poll_votes_poll_id_idx").on(table.pollId),
  userIdIdx: index("trending_poll_votes_user_id_idx").on(table.userId),
}));

export const insertTrendingPollVoteSchema = createInsertSchema(trendingPollVotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TrendingPollVote = typeof trendingPollVotes.$inferSelect;
export type InsertTrendingPollVote = z.infer<typeof insertTrendingPollVoteSchema>;

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
  userId: varchar("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(), // References xpActions.actionKey
  xpDelta: integer("xp_delta").notNull(), // Can be negative for deductions
  idempotencyKey: text("idempotency_key").notNull(), // Prevents duplicate awards
  source: text("source").notNull().default("user_action"), // 'user_action', 'legacy_migration', 'admin_adjustment'
  metadata: jsonb("metadata"), // Flexible: { targetId, targetType, ip_address, device_id, etc. }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueIdempotency: unique().on(table.userId, table.idempotencyKey),
  userActionDateIdx: index("idx_xp_ledger_user_action_date").on(table.userId, table.actionType, table.createdAt),
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
  // FK added in migration 0013 (NOT VALID → needs VALIDATE after orphan cleanup).
  // NO cascade — credit history is an audit log and must survive profile deletion.
  userId: varchar("user_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
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
  userHistoryIdx: index("credit_ledger_user_history_idx").on(table.userId, table.createdAt),
  // txn_type-first index for the /admin/amm/house aggregation and any
  // future analytics that scan by txn_type independently of user_id.
  // Added in migration 0064.
  txnTypeCreatedAtIdx: index("credit_ledger_txn_type_created_at_idx").on(table.txnType, table.createdAt.desc()),
}));

export const insertCreditLedgerSchema = createInsertSchema(creditLedger).omit({
  id: true,
  createdAt: true,
});

export type CreditLedger = typeof creditLedger.$inferSelect;
export type InsertCreditLedger = z.infer<typeof insertCreditLedgerSchema>;

// Credit earn-loop config — admin-tunable rates for engagement
// rewards. Mirrors xpActions in shape so the admin Credits tab
// and the runtime adjustCredits() lookup can reuse the same
// patterns. Seed data lives in shared/credit-config.ts and is
// upserted by server/scripts/seed-gamification.ts.
export const creditActions = pgTable("credit_actions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // Stable snake_case identifier
  label: text("label").notNull(),
  proposedCredits: integer("proposed_credits").notNull().default(0),
  // null = no per-day limit. Daily cap is enforced in adjustCredits()
  // by counting credit_ledger rows for this user + key in the UTC day.
  dailyCap: integer("daily_cap"),
  // Free-form for now (ENGAGEMENT | QUALITY | STREAK | SOCIAL | SPECIAL).
  // Kept as text instead of an enum so admins can add categories
  // without a schema migration.
  category: text("category").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  // True for actions that only fire after admin approval (e.g.
  // suggestion_approved). The runtime adjustCredits() helper does
  // not check this — callers gate themselves via the approval flow.
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertCreditActionSchema = createInsertSchema(creditActions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreditAction = typeof creditActions.$inferSelect;
export type InsertCreditAction = z.infer<typeof insertCreditActionSchema>;

// Share-click attribution log. Powers the share_click credit award
// path in POST /api/share/track-click and feeds future share-funnel
// analytics. Designed to be append-only — we never mutate clickedAt
// or sharerUserId; `credited` flips from false → true exactly once
// when the matching credit_ledger row is written, paired with the
// idempotency key for cross-table reconciliation.
export const shareClicks = pgTable("share_clicks", {
  id: serial("id").primaryKey(),
  // Owner of the share link. References profiles(id); FK declared
  // in migration 0059 to keep the schema migration loose-coupled.
  sharerUserId: text("sharer_user_id").notNull(),
  // Surface the link came from: person_profile, vote_deck, matchup,
  // poll, market, prediction_win, portfolio, comment, public_profile,
  // referral. Free-form text so we can add surfaces without a schema
  // migration; the client side enforces the canonical set.
  shareSurface: text("share_surface").notNull(),
  shareUrl: text("share_url").notNull(),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).defaultNow(),
  // HTTP Referer of the inbound click. Internal hosts (voxdex.com,
  // localhost) are rejected before insert — anything that lands here
  // is by definition external.
  externalReferrer: text("external_referrer"),
  // SHA-256 of the X-Forwarded-For first hop. We never store the raw
  // IP. Used in the `(sharerUserId, ipHash, utc-date)` dedup so the
  // same household refreshing the link doesn't farm clicks.
  ipHash: text("ip_hash"),
  credited: boolean("credited").notNull().default(false),
  // The exact idempotencyKey we passed to adjustCredits(), so the
  // admin reconciliation tab can join share_clicks to credit_ledger
  // without guessing.
  creditIdempotencyKey: text("credit_idempotency_key").unique(),
}, (table) => ({
  sharerHistoryIdx: index("share_clicks_sharer_idx").on(table.sharerUserId, table.clickedAt),
}));

export const insertShareClickSchema = createInsertSchema(shareClicks).omit({
  id: true,
  clickedAt: true,
});

export type ShareClick = typeof shareClicks.$inferSelect;
export type InsertShareClick = z.infer<typeof insertShareClickSchema>;

// User Profiles - linked to Supabase Auth, stores profile info and role
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey(), // Supabase Auth user ID (not auto-generated)
  username: text("username").unique(),
  // DEPRECATED: removed from API responses, types, and UI in the
  // username/displayName merge commit. Column kept in the DB for one
  // release as a rollback safety net; will be dropped in a follow-up
  // migration (`migrations/0026_profiles_drop_full_name.sql`). Do not
  // re-introduce reads or writes of this field.
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  avatarSeed: text("avatar_seed"),
  isPublic: boolean("is_public").notNull().default(true),
  // Controls visibility of *open* AMM positions and the user's identity
  // on per-market trade feeds, Town Square, and the leaderboard. Settled
  // history stays public regardless. Migration: 0055.
  positionsPublic: boolean("positions_public").notNull().default(true),
  role: text("role").notNull().default("user"), // 'user', 'admin', 'moderator'
  rank: text("rank").notNull().default("Citizen"), // From ranks table: Citizen, Aspirant, Insider, etc.
  // Highest rank the user has ever reached. Lazily promoted whenever
  // `rank` crosses a higher tier (see awardXp() in
  // server/services/gamification.ts). Survives any future rebalance
  // that demotes users at the bottom of a tier so the UI can show
  // "your peak was N". Nullable for legacy rows that pre-date the
  // ranks-overhaul migration; backfilled to current rank on apply.
  highestRank: text("highest_rank"),
  xpPoints: integer("xp_points").notNull().default(0),
  // Default 0 — runtime signup grant in POST /api/profile/sync awards
  // SIGNUP_CREDIT_GRANT (10,000) and writes the matching credit_ledger
  // row. Pre-credits-overhaul this defaulted to 1000, which conflicted
  // with the runtime grant and produced silent grant/default skew for
  // any user created via direct INSERT.
  predictCredits: integer("predict_credits").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  // Highest streak the user has ever reached. Lazily promoted whenever
  // currentStreak crosses its previous peak (see daily-checkin endpoint).
  // Survives streak resets so the UI can show "your best was N days".
  longestStreak: integer("longest_streak").notNull().default(0),
  // ISO date string (YYYY-MM-DD, UTC) for the last day this user
  // completed daily check-in. Authoritative input to the streak state
  // machine: today => idempotent, yesterday => increment, older => reset
  // to 1. Nullable for accounts that have never checked in.
  lastLoginDate: text("last_login_date"),
  // Referral funnel — see migrations/0059_referral_system.sql.
  // referralCode: stable per-user share token ("VX" + 6 chars) shown
  //   on the /me Refer a Friend card; embedded as ?ref= on shareable
  //   links. Generated on first profile sync with retry-on-collision.
  // referredBy: profile.id of the referrer when the new user signed
  //   up via a ?ref= link. ON DELETE SET NULL so referrer deletion
  //   doesn't cascade away the referred user.
  // firstActionAt: stamped exactly once when the user completes a
  //   "meaningful action" (vote / prediction / comment / overall
  //   rating). Gates the referral_completed credit fire so a brand-
  //   new account can't trigger a payout by signing up alone.
  // referralCreditFiredAt: stamped on the *referrer's* row (not the
  //   referee's) when their referral_completed credit lands.
  //   Defence-in-depth alongside the credit_ledger idempotency key.
  referralCode: text("referral_code").unique(),
  // FK back to profiles.id is declared in migration 0059 (Drizzle
  // can't express self-references on the same table cleanly inside
  // the column builder).
  referredBy: text("referred_by"),
  firstActionAt: timestamp("first_action_at", { withTimezone: true }),
  referralCreditFiredAt: timestamp("referral_credit_fired_at", { withTimezone: true }),
  // User-initiated account deletion (7-day soft-delete window).
  // See migration 0065. Lifecycle:
  //   - `deletionRequestedAt` is set when the user calls
  //     POST /api/me/account/delete. The matching
  //     `deletionScheduledFor` is requestedAt + 7 days. The user
  //     can still log in, see, and CANCEL during this window.
  //   - `deletedAt` is set by the hourly account-deletion sweeper
  //     when `deletionScheduledFor` has elapsed. At that point the
  //     row is anonymised (PII cleared, username randomised,
  //     isPublic forced false) and `predictCredits` zeroed. The
  //     row itself remains so credit_ledger / market_bets /
  //     comments / votes FKs stay intact (the audit-log
  //     contract). Public profile displays "Deleted user".
  //   - Cancellation clears both `*RequestedAt` and
  //     `*ScheduledFor` and is only valid while `deletedAt` is
  //     null.
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletionScheduledFor: timestamp("deletion_scheduled_for", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Free-form profile bio. Surfaced on /me + public profile and
  // gates the `getting_personal` PROFILE badge alongside the
  // user's display name.
  bio: text("bio"),
  // Demographic fields — see migration 0060_badge_system.sql.
  // Power the PROFILE-category badges (community_member,
  // full_voxmaxer) and the PROFILE XP/credit actions
  // (profile_demographics). Treated as opt-in PII: nullable by
  // default, made visible to other users only when
  // profileFieldsPublic is set. The badge-completion check inspects
  // the columns directly; admin tooling reads through
  // profileFieldsPublic before exposing them on public surfaces.
  // Stored as Postgres `date` per migration 0060. `mode: "string"` keeps
  // the runtime value as an ISO `YYYY-MM-DD` string so the PATCH handler
  // and the Settings form can pass values straight through without
  // needing to construct Date objects (which would tz-shift on write).
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  gender: text("gender"),
  countryOfOrigin: text("country_of_origin"),
  countryOfResidence: text("country_of_residence"),
  ethnicity: text("ethnicity"),
  // Legacy aggregate visibility toggle. Superseded by the four
  // per-field flags below (migration 0062) but kept on the row for
  // backward compat — older clients that still PATCH this field will
  // continue to land. New code reads the per-field flags.
  profileFieldsPublic: boolean("profile_fields_public").notNull().default(false),
  // Per-field demographic visibility (migration 0062). Defaults
  // mirror the column defaults: gender + country visible by default,
  // DOB + ethnicity hidden by default. The PublicProfile API gates
  // each field on its matching flag.
  dobPublic: boolean("dob_public").notNull().default(false),
  genderPublic: boolean("gender_public").notNull().default(true),
  countryPublic: boolean("country_public").notNull().default(true),
  ethnicityPublic: boolean("ethnicity_public").notNull().default(false),
  // Account-tab extras — see migrations 0061, 0070.
  // recoveryEmail is treated as opt-in PII and is never exposed via
  // public profile endpoints. OTP hash/expiry are server-only.
  recoveryEmail: text("recovery_email"),
  recoveryEmailVerified: boolean("recovery_email_verified").notNull().default(false),
  // Pending recovery-email OTP — never returned from /api/profile/me.
  recoveryEmailVerifyCodeHash: text("recovery_email_verify_code_hash"),
  recoveryEmailVerifyExpiresAt: timestamp("recovery_email_verify_expires_at"),
  phoneNumber: text("phone_number"),
  // About-Me discoverability fields. Stored without the leading '@'
  // (the PATCH handler strips it) so we can reconstruct social URLs
  // unambiguously. Visibility is gated by socialHandlesPublic /
  // occupationPublic — each privacy-sensitive bucket has its own
  // opt-in so a user can share occupation without sharing socials.
  socialXHandle: text("social_x_handle"),
  socialInstagramHandle: text("social_instagram_handle"),
  occupationIndustry: text("occupation_industry"),
  socialHandlesPublic: boolean("social_handles_public").notNull().default(false),
  occupationPublic: boolean("occupation_public").notNull().default(false),
  totalVotes: integer("total_votes").notNull().default(0),
  totalPredictions: integer("total_predictions").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  isAgent: boolean("is_agent").notNull().default(false),
  // Sentinel flag for the singleton "house" account that seeds AMM markets
  // with virtual liquidity. Only ever true for HOUSE_PROFILE_ID
  // (00000000-0000-0000-0000-0000000000aa). User-facing listings should
  // filter this out the same way they filter `isAgent`.
  isHouse: boolean("is_house").notNull().default(false),
  lastActiveAt: timestamp("last_active_at"),
  // Set when the user accepts ToS + Privacy on /login/welcome. NULL means not
  // yet captured — used by the welcome screen to decide whether to show.
  tosAcceptedAt: timestamp("tos_accepted_at"),
  // Categories the user explicitly selected via the InterestsPicker. Empty
  // array means "not yet picked" (treated as cold-start). Stored as text[] of
  // canonical category ids (see shared/constants.ts CANONICAL_CATEGORIES).
  statedInterests: text("stated_interests").array().notNull().default(sql`'{}'`),
  // Set when the user dismissed/skipped the InterestsPicker. Used by the
  // re-prompt gate together with totalVotes / totalPredictions and time
  // elapsed so we soft-nudge engaged users instead of nagging on every visit.
  interestsPromptDismissedAt: timestamp("interests_prompt_dismissed_at"),
  // Set when the user dismisses the inactive VersusCard help footer (X).
  // NULL = show hint until dismissed; mirrors interests_prompt_dismissed_at.
  matchupHelpDismissedAt: timestamp("matchup_help_dismissed_at"),
  // Multi-step onboarding (migration 0063). `onboardingStep` is the highest
  // step the user has reached (0..5 — see WelcomePage container for the
  // ordered list). `onboardingCompletedAt` is stamped when the user lands
  // on the completion screen and is the canonical signal for NewUserGate:
  // a NULL value means the user is still in the flow and must finish before
  // they're released into the rest of the app.
  onboardingStep: integer("onboarding_step").notNull().default(0),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({
  createdAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

// Badge definitions. Canonical list lives in shared/badge-config.ts;
// seedBadges() in server/scripts/seed-gamification.ts upserts that
// list into this table on every run. Keeping the runtime row in the
// DB (instead of reading the config file) means admin toggles for
// isActive / visibleOnFrontend take effect without a redeploy.
export const badges = pgTable("badges", {
  id: serial("id").primaryKey(),
  // Stable snake_case identifier — referenced by user_badges and
  // every awardBadge() call site. NEVER rename without a migration.
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // VOTING | PREDICTION | CONTENT | STREAK | SOCIAL | PROFILE | SPECIAL.
  // Free-form text so admins can add categories without a schema
  // migration; canonical values mirror BADGE_CATEGORIES in
  // shared/badge-config.ts.
  category: text("category").notNull(),
  // COMMON | RARE | EPIC | LEGENDARY. Same shape contract as category.
  rarity: text("rarity").notNull(),
  // Lucide icon name (kebab-case), resolved client-side.
  icon: text("icon").notNull(),
  // Free-form criteria descriptor. Used only by admin tooling and
  // the How It Works page — runtime award logic relies on the
  // hand-written check helpers in server/services/badges.ts, NOT on
  // this column. Keeping it as JSON makes the admin UI self-
  // documenting without forcing the runtime to interpret it.
  criteriaJson: jsonb("criteria_json"),
  isActive: boolean("is_active").notNull().default(true),
  // True for badges shown on the public Badges grid + How It Works
  // page. Hidden badges (e.g. `founder`) still award normally and
  // appear on the holder's profile, but aren't advertised.
  visibleOnFrontend: boolean("visible_on_frontend").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertBadgeSchema = createInsertSchema(badges).omit({
  id: true,
  createdAt: true,
});

export type Badge = typeof badges.$inferSelect;
export type InsertBadge = z.infer<typeof insertBadgeSchema>;

// Award log. One row per (user, badge) pair — the unique constraint
// prevents double-awards even if a caller forgets to pass the
// idempotency key. The idempotencyKey UNIQUE is the second guard
// rail: deterministic for automatic awards
// (`badge_${userId}_${badgeKey}`) and prefixed for admin manual
// awards (`badge_manual_${userId}_${badgeKey}`).
export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  badgeKey: text("badge_key").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).defaultNow(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  metadata: jsonb("metadata"),
}, (table) => ({
  userBadgeUnique: unique("user_badges_user_badge_key_unique").on(
    table.userId,
    table.badgeKey,
  ),
  userIdx: index("user_badges_user_id_idx").on(table.userId),
  badgeKeyIdx: index("user_badges_badge_key_idx").on(table.badgeKey),
}));

export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({
  id: true,
  earnedAt: true,
});

export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;

// Phase 3 Interest Picker — behavioural blending aggregate.
// One row per (user_id, category_id). No event log; we keep aggregate
// counts + first/last timestamps and decay at read time so ingest is
// O(1) and the table stays capped at CANONICAL_CATEGORIES.length rows
// per user. Writes are fire-and-forget upserts from server/lib/
// engagementWriter.ts after the primary vote/bet insert commits.
export const userCategoryEngagement = pgTable("user_category_engagement", {
  userId: varchar("user_id").notNull(),
  // Canonical kebab-lowercase id from shared/constants.ts
  // CANONICAL_CATEGORIES. Enforced structurally via CHECK constraint in
  // migration 0043 — never compare without trusting the constraint.
  categoryId: text("category_id").notNull(),
  // Category-attributed vote-like events (matchup, sentiment poll,
  // opinion poll, induction, over/underrated). Weight 1 each.
  voteCount: integer("vote_count").notNull().default(0),
  // Prediction-market stake-weighted score. Each bet contributes
  // min(3 * log1p(stakeCredits), PREDICTION_STAKE_WEIGHT_CAP). Stored as
  // numeric(10,3) in Postgres — Drizzle maps that to string-as-decimal
  // to avoid JS float drift, so consumers should parseFloat() it.
  betWeight: numeric("bet_weight", { precision: 10, scale: 3 }).notNull().default("0"),
  // Anchors the blend curve (stated vs behaviour slide over 4 weeks
  // from this timestamp). Never updated after the first engagement row
  // is inserted for this (user, category) pair.
  firstEngagedAt: timestamp("first_engaged_at").notNull().defaultNow(),
  // Drives the read-time exponential decay (30-day half-life default).
  lastEngagedAt: timestamp("last_engaged_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.categoryId] }),
  userIdx: index("user_category_engagement_user_id_idx").on(table.userId),
  userLastEngagedIdx: index("user_category_engagement_user_last_engaged_idx").on(
    table.userId,
    table.lastEngagedAt,
  ),
}));

export type UserCategoryEngagement = typeof userCategoryEngagement.$inferSelect;
export type InsertUserCategoryEngagement = typeof userCategoryEngagement.$inferInsert;

// Phase 4 — Anonymous voting budget. One row per (fdx_sid, surface_type,
// target_id); re-votes are upserts against the composite PK so they
// consume zero additional units. Written by server/lib/anonBudget.ts;
// wiped by the signup-cleanup branch in /api/profile/sync.
export const anonVoteBudget = pgTable("anon_vote_budget", {
  fdxSid: text("fdx_sid").notNull(),
  surfaceType: text("surface_type").notNull(),
  targetId: text("target_id").notNull(),
  // timestamptz to match the DB column (see migration 0049).
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.fdxSid, table.surfaceType, table.targetId] }),
  sidIdx: index("anon_vote_budget_sid_idx").on(table.fdxSid),
  createdIdx: index("anon_vote_budget_created_idx").on(table.createdAt),
  surfaceCheck: check(
    "anon_vote_budget_surface_check",
    sql`${table.surfaceType} IN ('matchup_poll','opinion_poll','induction','trending_poll','celebrity_person')`,
  ),
}));

export type AnonVoteBudget = typeof anonVoteBudget.$inferSelect;
export type InsertAnonVoteBudget = typeof anonVoteBudget.$inferInsert;

// Relations for gamification tables
export const xpLedgerRelations = relations(xpLedger, ({ one }) => ({
  user: one(profiles, {
    fields: [xpLedger.userId],
    references: [profiles.id],
  }),
}));

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(profiles, {
    fields: [creditLedger.userId],
    references: [profiles.id],
  }),
}));

export const usersRelations = relations(users, () => ({
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  votes: many(votes),
  xpLedgerEntries: many(xpLedger),
  creditLedgerEntries: many(creditLedger),
  itemPrivacy: many(profileItemPrivacy),
}));

// Per-item public/private overrides for the user's profile. A row means
// "this specific item is HIDDEN from my public profile". Absence means the
// item follows the global profiles.isPublic setting.
// itemType is one of: "matchup", "sentiment", "trending_poll", "opinion_poll",
//                     "image_curate", "induction", "value_vote", "market_bet".
// itemId is stored as text so mixed PK types (bigint, uuid, varchar) all fit.
export const profileItemPrivacy = pgTable("profile_item_privacy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),
  itemId: text("item_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserItem: uniqueIndex("profile_item_privacy_user_item_unique").on(
    table.userId,
    table.itemType,
    table.itemId,
  ),
  byUser: index("profile_item_privacy_by_user_idx").on(table.userId),
}));

export const profileItemPrivacyRelations = relations(profileItemPrivacy, ({ one }) => ({
  user: one(profiles, {
    fields: [profileItemPrivacy.userId],
    references: [profiles.id],
  }),
}));

/** Admin-managed list of allowed category IDs (kebab-case); aligns with CANONICAL_CATEGORIES. */
export const contentCategories = pgTable("content_categories", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ContentCategoryRow = typeof contentCategories.$inferSelect;

export type ProfileItemPrivacy = typeof profileItemPrivacy.$inferSelect;
export type InsertProfileItemPrivacy = typeof profileItemPrivacy.$inferInsert;

// ============================================================================
// PREDICTION MARKETS TABLES (Admin Dashboard)
// ============================================================================

// Prediction Markets - Core table for all prediction market types
export const predictionMarkets = pgTable("prediction_markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketType: text("market_type").notNull(), // 'jackpot', 'updown', 'h2h', 'race', 'gainer', 'community'
  // Pricing engine: 'amm' (LMSR shares, default) or 'parimutuel' (jackpot
  // exact-score only). Defaults to AMM after the parimutuel sunset — every
  // non-jackpot creation path is expected to land as AMM, so a forgotten
  // explicit value falls into the safe bucket. Jackpot creation paths
  // MUST set `engine: 'parimutuel'` explicitly (see
  // server/jobs/market-generator.ts `generateWeeklyJackpot`).
  engine: text("engine").notNull().default("amm"),
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
  openMarketType: text("open_market_type"), // 'binary' | 'multi' | 'updown' — only when marketType='community'
  teaser: text("teaser"), // Short tagline for card display
  description: text("description"), // Longer rich description for detail page
  category: text("category"), // 'politics', 'tech', 'entertainment', 'sports', 'business', 'creator', 'misc'
  tags: text("tags").array(), // Freeform tags for filtering
  coverImageUrl: text("cover_image_url"),
  sourceUrl: text("source_url"), // Link to source article/event
  featured: boolean("featured").default(false),
  timezone: text("timezone").default("UTC"),
  resolutionCriteria: text("resolution_criteria").array(), // Array of criteria strings
  resolutionSources: jsonb("resolution_sources"), // [{label, url?}]
  resolutionNotes: text("resolution_notes"), // Admin notes on how it was resolved
  resolveMethod: text("resolve_method"), // 'admin_manual' | 'oracle' | 'api'
  underlying: text("underlying"), // For updown: e.g. "Bitcoin", "S&P 500"
  metric: text("metric"), // For updown: e.g. "price", "market cap"
  strike: numeric("strike"), // For updown: the strike value
  unit: text("unit"), // For updown: e.g. "$", "pts"
  closeAt: timestamp("close_at"), // When betting closes (can differ from endAt/resolution)
  personId: varchar("person_id"), // Linked celebrity (optional)
  isLive: boolean("is_live").default(true), // Legacy - use visibility instead
  visibility: text("visibility").default("live"), // draft | live | inactive | archived
  inactiveMessage: text("inactive_message"), // Custom message shown on inactive cards (e.g. "Coming Soon")
  weekNumber: integer("week_number"),
  tieRule: text("tie_rule").default("refund"), // 'refund' | 'down_wins' | 'up_wins'
  cadence: text("cadence").default("weekly"), // 'daily' | 'weekly' | 'custom'
  baselineScore: integer("baseline_score"), // Denormalized from metadata.openingScore for easy API access
  resolutionSummary: text("resolution_summary"), // AI-generated one-sentence summary of the resolution; null until generated
  /** Manual ordering in admin / Vote page for world (community) markets; other market types stay 0. */
  cmsDisplayOrder: integer("cms_display_order").notNull().default(0),
}, (table) => ({
  statusEndIdx: index("prediction_markets_status_end_idx").on(table.status, table.endAt),
  personIdx: index("prediction_markets_person_idx").on(table.personId),
}));

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
  personId: varchar("person_id").references(() => trackedPeople.id, { onDelete: "set null" }), // Nullable - for celebrity-based entries
  label: text("label").notNull(), // Display name (snapshotted for non-person entries)
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  totalStake: integer("total_stake").notNull().default(0), // Total credits staked on this entry
  resolutionStatus: text("resolution_status").notNull().default("pending"), // 'pending', 'winner', 'loser', 'void'
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  imageUrl: text("image_url"), // Avatar/image for this entry (manual URL or resolved from linked person)
  noStake: integer("no_stake").notNull().default(0), // Total credits staked "No" on this entry
}, (table) => ({
  marketIdx: index("market_entries_market_idx").on(table.marketId),
}));

export const insertMarketEntrySchema = createInsertSchema(marketEntries).omit({
  id: true,
  createdAt: true,
  totalStake: true,
  noStake: true,
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
  agentId: varchar("agent_id"),
  confidence: numeric("confidence", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  betMetadata: jsonb("bet_metadata"), // { confidence?: 1-5, thesis?: string, scoreAtEntry?: number }
  direction: text("direction").notNull().default("yes"), // "yes" | "no"
  // AMM-only fields (NULL on legacy parimutuel rows).
  // actionType: 'parimutuel' for pool-split bets; 'buy' / 'sell' for AMM
  // share trades. Defaulted to 'parimutuel' so back-compat is automatic.
  actionType: text("action_type").notNull().default("parimutuel"),
  // Number of shares (positive for both buy and sell — sign is in actionType).
  // Numeric not integer because LMSR uses fractional shares for smooth pricing.
  shareCount: numeric("share_count"),
  // Average price per share at the time of the trade. Useful for charts and
  // the position card's "avg entry price" display.
  pricePerShare: numeric("price_per_share"),
}, (table) => ({
  marketStatusIdx: index("market_bets_market_status_idx").on(table.marketId, table.status),
  userStatusIdx: index("market_bets_user_status_idx").on(table.userId, table.status),
  entryIdx: index("market_bets_entry_idx").on(table.entryId),
}));

export const insertMarketBetSchema = createInsertSchema(marketBets).omit({
  id: true,
  createdAt: true,
  settledAt: true,
  payoutAmount: true,
  betMetadata: true,
});

export type MarketBet = typeof marketBets.$inferSelect;
export type InsertMarketBet = z.infer<typeof insertMarketBetSchema>;

// Relations for prediction markets
export const predictionMarketsRelations = relations(predictionMarkets, ({ one, many }) => ({
  entries: many(marketEntries),
  bets: many(marketBets),
  // Optional 1:1 — present only for engine='amm' markets.
  ammState: one(marketAmmState, {
    fields: [predictionMarkets.id],
    references: [marketAmmState.marketId],
  }),
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

/**
 * Per-market AMM (LMSR) state. Exists only for markets with
 * `predictionMarkets.engine = 'amm'`; absent for legacy parimutuel
 * markets. Created by `seedAmmMarket` at market open and mutated by
 * every buy/sell (Phase 3).
 *
 * `liquidityB`: the LMSR liquidity parameter b. Set once at seed time
 *   via `seedB(numOutcomes, targetMaxLoss)` and never changed.
 *
 * `outcomeOrder`: entryIds in the canonical order used to project the
 *   `shareQuantities` JSONB into the flat `q: number[]` that the LMSR
 *   engine in `shared/lib/amm/lmsr.ts` operates on. Stable for the
 *   life of the market.
 *
 * `shareQuantities`: { [entryId]: number } — fractional share count
 *   per entry. Always exactly the entries in `outcomeOrder`.
 *
 * `houseSeedAmount`: integer credits the house deposited to bootstrap
 *   the AMM at q = 0 (= ceil(b · ln(N))). Returned (plus net user
 *   credits in, minus payout liability) to house at settlement.
 *
 * `totalUserCreditsIn`: running net of buy costs minus sell proceeds.
 *   Plumbed straight into `housePnL` at settlement so refunds, voids
 *   and mid-flight sells all reconcile correctly.
 */
export const marketAmmState = pgTable("market_amm_state", {
  marketId: varchar("market_id").primaryKey().references(() => predictionMarkets.id, { onDelete: "cascade" }),
  liquidityB: numeric("liquidity_b").notNull(),
  outcomeOrder: text("outcome_order").array().notNull(),
  shareQuantities: jsonb("share_quantities").notNull(),
  houseSeedAmount: integer("house_seed_amount").notNull(),
  totalUserCreditsIn: numeric("total_user_credits_in").notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketAmmStateRelations = relations(marketAmmState, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketAmmState.marketId],
    references: [predictionMarkets.id],
  }),
}));

export const insertMarketAmmStateSchema = createInsertSchema(marketAmmState).omit({
  updatedAt: true,
});

export type MarketAmmState = typeof marketAmmState.$inferSelect;
export type InsertMarketAmmState = z.infer<typeof insertMarketAmmStateSchema>;

// ============================================================================
// AMM PRICE SNAPSHOTS (Phase 12)
// ============================================================================

/**
 * Append-only history of marginal AMM prices per (market, outcome).
 *
 * Two writers populate this table:
 *  - `trade`: invoked from `executeBuy` / `executeSell` after the
 *    transaction commits. Writes one row per outcome so the chart
 *    reflects *all* outcomes moving in lockstep (LMSR sums to 1).
 *  - `sampler`: a 5-minute cron over every OPEN AMM market that
 *    inserts a row only when no `trade` snapshot for that market has
 *    landed in the last 5 minutes. Keeps the chart visually smooth
 *    on quiet markets without unbounded growth on noisy ones.
 *
 * Read path: `/api/markets/:id/price-history?bucket=5m|1h|1d&from=...`
 * uses `date_trunc(bucket, recorded_at)` to compress per-bucket so
 * one row per (bucket, outcome) ships to the client. Sparklines on
 * cards request `?bucket=1h&from=now-7d`. Detail-page charts use
 * `5m`. The retention story is "all rows until we feel pressure" —
 * the bucket index covers the only access pattern we have.
 */
export const ammPriceSnapshots = pgTable(
  "amm_price_snapshots",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    marketId: varchar("market_id")
      .notNull()
      .references(() => predictionMarkets.id, { onDelete: "cascade" }),
    /**
     * Entry / outcome id. Stored as the canonical entry uuid so it
     * joins cleanly with marketEntries and matches what callers
     * already index by on the client.
     */
    entryId: varchar("entry_id").notNull(),
    /**
     * Marginal LMSR price for this outcome at write time. Stored as
     * numeric so we don't lose precision on long-tail markets where
     * 1e-6 differences matter for the chart.
     */
    price: numeric("price").notNull(),
    /** Either 'trade' (post-trade hook) or 'sampler' (cron). */
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => ({
    marketTimeIdx: index("amm_price_snapshots_market_time_idx").on(
      t.marketId,
      t.recordedAt,
    ),
    marketEntryTimeIdx: index("amm_price_snapshots_market_entry_time_idx").on(
      t.marketId,
      t.entryId,
      t.recordedAt.desc(),
    ),
  }),
);

export const ammPriceSnapshotsRelations = relations(
  ammPriceSnapshots,
  ({ one }) => ({
    market: one(predictionMarkets, {
      fields: [ammPriceSnapshots.marketId],
      references: [predictionMarkets.id],
    }),
  }),
);

export type AmmPriceSnapshot = typeof ammPriceSnapshots.$inferSelect;
export type InsertAmmPriceSnapshot = typeof ammPriceSnapshots.$inferInsert;

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
}, (table) => ({
  // Listing endpoint (/api/admin/audit-log) orders by createdAt DESC
  // with LIMIT. The `(createdAt DESC)` index turns the top-N into an
  // index scan; the `(adminId, createdAt DESC)` covers per-admin
  // filtering. Added in migration 0064.
  createdAtIdx: index("admin_audit_log_created_at_idx").on(table.createdAt.desc()),
  adminIdCreatedAtIdx: index("admin_audit_log_admin_id_created_at_idx").on(table.adminId, table.createdAt.desc()),
}));

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
  country: text("country"), // ISO 3166-1 alpha-2 country code from IP geolocation
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
  // Approval SEED aggregate MIRROR — admin-display only.
  // Seed votes are physically stored as rows in `user_votes` with synthetic
  // user_ids (`seed-system-approval%`); these two columns mirror the per-
  // celebrity totals so the admin "Edit Celebrity" modal can render the
  // 1-5 baseline without re-aggregating user_votes. They MUST NOT be added
  // on top of the user_votes aggregate when computing display fields —
  // doing so double-counts seeds. See server/services/celebrity-metrics-recompute.ts.
  seedApprovalCount: integer("seed_approval_count").notNull().default(0),
  seedApprovalSum: integer("seed_approval_sum").notNull().default(0), // sum of ratings (count * avg_rating)
  // Approval DISPLAY aggregates — sourced from COUNT/SUM over user_votes
  // (which already includes seed rows). Single source of truth.
  approvalVotesCount: integer("approval_votes_count").notNull().default(0),
  approvalAvgRating: real("approval_avg_rating"), // 1-5 scale
  approvalPct: real("approval_pct"), // 0-100 scale ((avg_rating - 1) / 4 * 100)
  // Value SEED aggregates (pre-launch baseline, no fake users)
  seedUnderratedCount: integer("seed_underrated_count").notNull().default(0),
  seedOverratedCount: integer("seed_overrated_count").notNull().default(0),
  seedFairlyRatedCount: integer("seed_fairly_rated_count").notNull().default(0),
  // Value DISPLAY aggregates (seed + real votes combined)
  underratedVotesCount: integer("underrated_votes_count").notNull().default(0),
  overratedVotesCount: integer("overrated_votes_count").notNull().default(0),
  fairlyRatedVotesCount: integer("fairly_rated_votes_count").notNull().default(0),
  underratedPct: real("underrated_pct"), // 0-100
  overratedPct: real("overrated_pct"), // 0-100
  fairlyRatedPct: real("fairly_rated_pct"), // 0-100
  valueScore: real("value_score"), // -100 to +100 (underrated_pct - overrated_pct)
  visibility: text("visibility").notNull().default("live"), // live | inactive | archived
  curateVisibility: text("curate_visibility").notNull().default("live"), // live | inactive | archived
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  approvalIdx: index("celebrity_metrics_approval_idx").on(table.approvalAvgRating),
  valueIdx: index("celebrity_metrics_value_idx").on(table.valueScore),
}));

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
  uniqueUserCelebrity: unique("celebrity_value_votes_user_id_celebrity_id_unique").on(table.userId, table.celebrityId),
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

// ============================================================================
// INGESTION RUNS - Tracks every data ingestion execution for health monitoring
// ============================================================================

export const ingestionRunStatusEnum = pgEnum("ingestion_run_status", ["running", "completed", "failed", "locked_out", "skipped", "failed_partial"]);

export const ingestionRuns = pgTable("ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: ingestionRunStatusEnum("status").notNull().default("running"),
  hourBucket: timestamp("hour_bucket"),
  snapshotsWritten: integer("snapshots_written").default(0),
  peopleProcessed: integer("people_processed").default(0),
  errorCount: integer("error_count").default(0),
  errorSummary: text("error_summary"),
  sourceTimings: jsonb("source_timings"),
  sourceStatuses: jsonb("source_statuses"),
  healthSummary: jsonb("health_summary"),
  lockAcquiredAt: timestamp("lock_acquired_at"),
  lockReleasedAt: timestamp("lock_released_at"),
  heartbeatAt: timestamp("heartbeat_at"),
  scoreVersion: varchar("score_version").default("v1"),
}, (table) => ({
  startedAtIdx: index("ingestion_runs_started_at_idx").on(table.startedAt),
  statusIdx: index("ingestion_runs_status_idx").on(table.status),
  singleRunningIdx: uniqueIndex("ingestion_runs_single_running_idx")
    .on(table.status)
    .where(sql`status = 'running'`),
}));

export const insertIngestionRunSchema = createInsertSchema(ingestionRuns).omit({
  id: true,
});

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type InsertIngestionRun = z.infer<typeof insertIngestionRunSchema>;

// ============================================================================
// OPINION POLLS — Multi-option polls (3–30 options, single-select vote)
// ============================================================================

export const opinionPolls = pgTable("opinion_polls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  summary: text("summary"),
  imageUrl: text("image_url"),
  featured: boolean("featured").default(false),
  visibility: text("visibility").default("draft"),
  displayOrder: integer("display_order").notNull().default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  slugUniqueIdx: uniqueIndex("opinion_polls_slug_unique").on(table.slug),
  slugIdx: index("opinion_polls_slug_idx").on(table.slug),
  categoryIdx: index("opinion_polls_category_idx").on(table.category),
  visibilityIdx: index("opinion_polls_visibility_idx").on(table.visibility),
}));

export const insertOpinionPollSchema = createInsertSchema(opinionPolls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OpinionPoll = typeof opinionPolls.$inferSelect;
export type InsertOpinionPoll = z.infer<typeof insertOpinionPollSchema>;

export const opinionPollOptions = pgTable("opinion_poll_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull().references(() => opinionPolls.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  personId: varchar("person_id").references(() => trackedPeople.id, { onDelete: "set null" }),
  orderIndex: integer("order_index").notNull().default(0),
  seedCount: integer("seed_count").notNull().default(0),
}, (table) => ({
  pollIdx: index("opinion_poll_options_poll_idx").on(table.pollId),
  orderIdx: index("opinion_poll_options_order_idx").on(table.pollId, table.orderIndex),
}));

export const insertOpinionPollOptionSchema = createInsertSchema(opinionPollOptions).omit({
  id: true,
});

export type OpinionPollOption = typeof opinionPollOptions.$inferSelect;
export type InsertOpinionPollOption = z.infer<typeof insertOpinionPollOptionSchema>;

export const opinionPollVotes = pgTable("opinion_poll_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull().references(() => opinionPolls.id, { onDelete: "cascade" }),
  optionId: varchar("option_id").notNull().references(() => opinionPollOptions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserPoll: unique("opinion_poll_votes_user_poll_unique").on(table.userId, table.pollId),
  pollIdx: index("opinion_poll_votes_poll_idx").on(table.pollId),
  optionIdx: index("opinion_poll_votes_option_idx").on(table.optionId),
}));

export const insertOpinionPollVoteSchema = createInsertSchema(opinionPollVotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OpinionPollVote = typeof opinionPollVotes.$inferSelect;
export type InsertOpinionPollVote = z.infer<typeof insertOpinionPollVoteSchema>;

// ============================================================================
// COMMENT REPORTS
// ============================================================================

export const commentReports = pgTable("comment_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // FK added in migration 0013 (NOT VALID → needs VALIDATE after orphan cleanup)
  commentId: varchar("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  reporterId: varchar("reporter_id").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  commentIdx: index("comment_reports_comment_idx").on(table.commentId),
  reporterIdx: index("comment_reports_reporter_idx").on(table.reporterId),
}));

export type CommentReport = typeof commentReports.$inferSelect;

// ============================================================================
// AI AGENT PREDICTION SYSTEM
// ============================================================================

/**
 * Singleton table holding the global pause state for *all* agent activity:
 * prediction loops (`agentRunner` + `actionWorker`), comment generation,
 * comment-vote sweeps and rating-vote sweeps. Used by the admin "Pause
 * agents" kill switch in the Agents tab.
 *
 * Always exactly one row keyed by `id='global'`. We use a singleton row
 * rather than env flags so:
 *   - Toggling does not require a deploy.
 *   - State survives restarts / multi-instance deployments.
 *   - We get a full audit trail (`pausedAt`, `pausedBy`, `reason`, `updatedAt`).
 *
 * Workers cache the value with a short TTL (~10s), so flipping the switch
 * propagates within seconds without hammering the DB on every tick.
 *
 * NOT a feature flag for non-agent LLM features ("why they're trending",
 * resolution summaries, news ingest, etc.) — those are completely
 * independent and keep running while agents are paused.
 */
export const agentRuntimeState = pgTable("agent_runtime_state", {
  id: text("id").primaryKey().default("global"),
  paused: boolean("paused").notNull().default(false),
  reason: text("reason"),
  pausedAt: timestamp("paused_at"),
  pausedBy: varchar("paused_by"),
  /** When true, commentWorker + commentVoteWorker skip sweeps; betting/votes continue. */
  commentsPaused: boolean("comments_paused").notNull().default(false),
  commentsPauseReason: text("comments_pause_reason"),
  commentsPausedAt: timestamp("comments_paused_at"),
  commentsPausedBy: varchar("comments_paused_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AgentRuntimeState = typeof agentRuntimeState.$inferSelect;

/**
 * Singleton table holding admin-tunable AMM knobs that we want to be
 * able to change *without* a deploy. Today the only field is
 * `preResolveCooldownMs` — the gap between the AMM trading cutoff and
 * `endAt`. Promoted out of a hardcoded constant in `lifecycle.ts` so
 * we can dial it up (e.g. 10 or 15 minutes) once we observe how late-
 * hour AMM trading actually behaves with the agent cohort live (Phase
 * 10+).
 *
 * Cache pattern matches `agentRuntimeState`: the in-process module
 * caches the value with a ~10s TTL so flipping the knob propagates
 * within seconds without hammering the DB on every betting check.
 *
 * Intentionally narrow today; expect to grow as Phase 10/11/12 add
 * more knobs (Kelly cap, per-engine max-loss override, etc.).
 */
export const ammRuntimeSettings = pgTable("amm_runtime_settings", {
  id: text("id").primaryKey().default("global"),
  preResolveCooldownMs: integer("pre_resolve_cooldown_ms").notNull().default(300_000),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: varchar("updated_by"),
});

export type AmmRuntimeSettings = typeof ammRuntimeSettings.$inferSelect;

/**
 * Persisted history of every AMM operational health-check run.
 *
 * Three writers (all via `runAndPersistAmmHealthCheck` in
 * server/jobs/amm-health.ts):
 *   - in-process scheduler in server/index.ts (every 15 min)
 *   - POST /api/cron/amm-health-check (external Railway / cron)
 *   - POST /api/admin/amm/operational-health/run (manual, rate-limited)
 *
 * Read by the admin "Operations" sub-tab in AdminAmmSection:
 *   - GET /api/admin/amm/operational-health/latest
 *   - GET /api/admin/amm/operational-health/history?hours=24
 *
 * `checks` is the full `CheckResult[]` from `runAmmHealthCheck` — name,
 * status, details, rowCount, sample. Stored as JSONB so the existing
 * `HealthCheckResult` shape maps 1:1 (no DTO drift).
 *
 * Migration: 0063_amm_health_check_runs.sql
 */
export const ammHealthCheckRuns = pgTable("amm_health_check_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull(),
  ok: boolean("ok").notNull(),
  total: integer("total").notNull(),
  passed: integer("passed").notNull(),
  warned: integer("warned").notNull(),
  failed: integer("failed").notNull(),
  lookbackDays: integer("lookback_days").notNull(),
  source: text("source").notNull(), // 'scheduler' | 'cron' | 'manual'
  triggeredBy: varchar("triggered_by").references(() => profiles.id, { onDelete: "set null" }),
  checks: jsonb("checks").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("amm_health_runs_started_at_idx").on(table.startedAt.desc()),
]);

export type AmmHealthCheckRun = typeof ammHealthCheckRuns.$inferSelect;

export const agentConfigs = pgTable("agent_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  username: text("username").notNull().unique(),
  bio: text("bio"),
  archetype: text("archetype").notNull(),
  specialties: text("specialties").array().notNull().default(sql`'{}'`),

  boldness: numeric("boldness", { precision: 3, scale: 2 }).notNull().default("0.50"),
  contrarianism: numeric("contrarianism", { precision: 3, scale: 2 }).notNull().default("0.30"),
  recencyWeight: numeric("recency_weight", { precision: 3, scale: 2 }).notNull().default("0.50"),
  prestigeBias: numeric("prestige_bias", { precision: 3, scale: 2 }).notNull().default("0.50"),
  confidenceCal: numeric("confidence_cal", { precision: 3, scale: 2 }).notNull().default("0.70"),
  riskAppetite: numeric("risk_appetite", { precision: 3, scale: 2 }).notNull().default("0.50"),
  consensusSensitivity: numeric("consensus_sensitivity", { precision: 3, scale: 2 }).notNull().default("0.50"),
  activityRate: numeric("activity_rate", { precision: 3, scale: 2 }).notNull().default("0.60"),

  simulationProfile: jsonb("simulation_profile"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AgentConfig = typeof agentConfigs.$inferSelect;

export const agentPerformance = pgTable("agent_performance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => agentConfigs.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalEntered: integer("total_entered").notNull().default(0),
  totalResolved: integer("total_resolved").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  avgBrierScore: numeric("avg_brier_score", { precision: 6, scale: 4 }),
  accuracy: numeric("accuracy", { precision: 5, scale: 4 }),
  categoryScores: jsonb("category_scores").notNull().default({}),
  beatCrowd: integer("beat_crowd").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueAgentPeriod: unique("agent_perf_agent_period_unique").on(table.agentId, table.periodStart, table.periodEnd),
  agentIdx: index("agent_performance_agent_idx").on(table.agentId),
}));

export type AgentPerformance = typeof agentPerformance.$inferSelect;

export const agentMemory = pgTable("agent_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => agentConfigs.id, { onDelete: "cascade" }),
  memoryType: text("memory_type").notNull(),
  content: text("content").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  agentCreatedIdx: index("agent_memory_agent_created_idx").on(table.agentId, table.createdAt),
}));

export type AgentMemory = typeof agentMemory.$inferSelect;

export const scheduledAgentActions = pgTable("scheduled_agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => agentConfigs.id, { onDelete: "cascade" }),
  marketId: varchar("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
  entryId: varchar("entry_id").notNull().references(() => marketEntries.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull().default("predict"),
  decisionPayload: jsonb("decision_payload").notNull(),
  stakeAmount: integer("stake_amount").notNull().default(100),
  executeAfter: timestamp("execute_after").notNull(),
  status: text("status").notNull().default("pending"),
  executedAt: timestamp("executed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pendingIdx: index("saa_pending_idx").on(table.status, table.executeAfter),
  agentMarketIdx: index("saa_agent_market_idx").on(table.agentId, table.marketId),
}));

export type ScheduledAgentAction = typeof scheduledAgentActions.$inferSelect;

export const cardRelatedPeople = pgTable("card_related_people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cardType: text("card_type").notNull(),
  cardId: varchar("card_id").notNull(),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCardPerson: uniqueIndex("card_related_people_unique_idx").on(table.cardType, table.cardId, table.personId),
  personIdx: index("card_related_people_person_idx").on(table.personId),
  cardIdx: index("card_related_people_card_idx").on(table.cardType, table.cardId),
}));

export type CardRelatedPerson = typeof cardRelatedPeople.$inferSelect;

// Approval Snapshots — periodic snapshots of approval metrics for time-series charts
export const approvalSnapshots = pgTable("approval_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => trackedPeople.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  approvalAvgRating: real("approval_avg_rating"),
  approvalVotesCount: integer("approval_votes_count").default(0),
  approvalPct: real("approval_pct"),
}, (table) => ({
  personTsIdx: index("approval_snapshots_person_ts_idx").on(table.personId, table.timestamp),
}));

export type ApprovalSnapshot = typeof approvalSnapshots.$inferSelect;

// ============================================================================
// SUGGESTIONS TABLE (Phase 0)
// ============================================================================

export const suggestions = pgTable("suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // 'matchup' | 'sentiment_poll' | 'opinion_poll' | 'induction' | 'profile_image' | 'open_market'
  payload: jsonb("payload").notNull(),
  submittedBy: varchar("submitted_by").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  adminNotes: text("admin_notes"),
  approvedAsId: text("approved_as_id"),
  approvedAsType: text("approved_as_type"),
  reviewedBy: varchar("reviewed_by").references(() => profiles.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  submitterIdx: index("suggestions_submitter_idx").on(table.submittedBy, table.createdAt),
  statusIdx: index("suggestions_status_idx").on(table.status, table.createdAt),
  typeStatusIdx: index("suggestions_type_status_idx").on(table.type, table.status),
}));

export const insertSuggestionSchema = createInsertSchema(suggestions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Suggestion = typeof suggestions.$inferSelect;
export type InsertSuggestion = z.infer<typeof insertSuggestionSchema>;

// ============================================================================
// IN-APP NOTIFICATIONS
// ============================================================================
//
// One row per user-visible event. Inserts are server-side only (service role);
// authenticated clients can SELECT/UPDATE their own rows via RLS in
// migration 0035. (user_id, idempotency_key) is unique so derivation jobs
// can re-run safely.
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  // See client/src/lib/notifications/registry.ts for the canonical list.
  kind: text("kind").notNull(),
  // 'predictions' | 'favorites' | 'social' | 'account' | 'system'
  category: text("category").notNull(),
  // Denormalized at write-time so historical strings stay stable across
  // UX iterations (renaming a kind label later won't rewrite the past).
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  // Social fanout (replier, upvoter, etc.). Nullable for system-driven kinds.
  actorUserId: varchar("actor_user_id"),
  // Polymorphic ref to the originating entity (market, comment, person, ...).
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  // Structured payload (payout, deltaRank, milestone, etc.).
  metadata: jsonb("metadata"),
  // 0 = silent (bell only), 1 = high (auto-toast in-session).
  priority: integer("priority").notNull().default(0),
  // For batched kinds — e.g. "upvote-milestone:<commentId>:5".
  groupKey: text("group_key"),
  // Critical for derivation jobs: re-running the job must not duplicate.
  idempotencyKey: text("idempotency_key").notNull(),
  // seenAt clears the bell badge the moment the panel opens; readAt is
  // set when the user actually clicks the row. Splitting them lets the
  // badge feel snappy without prematurely visually marking rows as read.
  seenAt: timestamp("seen_at"),
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueIdem: unique("notifications_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  userUnreadIdx: index("notifications_user_unread_idx").on(table.userId, table.readAt, table.createdAt),
  userKindIdx: index("notifications_user_kind_idx").on(table.userId, table.kind, table.createdAt),
  userCategoryIdx: index("notifications_user_category_idx").on(table.userId, table.category, table.createdAt),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  seenAt: true,
  readAt: true,
  dismissedAt: true,
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// Per-user notification preferences. Lazy-created on first read. The
// email/push columns are reserved for Phase 2 — the UI shows them as
// disabled "Coming soon" today, but storing them now keeps the data
// model multi-channel and avoids a follow-up migration later.
export const notificationPreferences = pgTable("notification_preferences", {
  userId: varchar("user_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),

  predictionsInApp: boolean("predictions_in_app").notNull().default(true),
  favoritesInApp: boolean("favorites_in_app").notNull().default(true),
  socialInApp: boolean("social_in_app").notNull().default(true),
  accountInApp: boolean("account_in_app").notNull().default(true),
  systemInApp: boolean("system_in_app").notNull().default(true),

  predictionsEmail: boolean("predictions_email").notNull().default(false),
  favoritesEmail: boolean("favorites_email").notNull().default(false),
  socialEmail: boolean("social_email").notNull().default(false),
  accountEmail: boolean("account_email").notNull().default(false),
  systemEmail: boolean("system_email").notNull().default(false),

  predictionsPush: boolean("predictions_push").notNull().default(false),
  favoritesPush: boolean("favorites_push").notNull().default(false),
  socialPush: boolean("social_push").notNull().default(false),
  accountPush: boolean("account_push").notNull().default(false),
  systemPush: boolean("system_push").notNull().default(false),

  /** When true, swipe-right dismisses and swipe-left marks read (mobile inbox). */
  invertNotificationSwipe: boolean("invert_notification_swipe").notNull().default(false),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreferences = typeof notificationPreferences.$inferInsert;

// Durable one-row state for marketing/lifecycle email unsubscribe. We keep
// this separate from channel preference placeholders so admin tooling can
// explicitly show whether a user clicked an unsubscribe link.
export const emailUnsubscribeState = pgTable("email_unsubscribe_state", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("marketing_lifecycle"),
  source: text("source").notNull().default("email_link"),
  tokenHash: text("token_hash"),
  unsubscribedAt: timestamp("unsubscribed_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailUnsubscribeState = typeof emailUnsubscribeState.$inferSelect;
export type InsertEmailUnsubscribeState = typeof emailUnsubscribeState.$inferInsert;

/**
 * Weekly leaderboard rank snapshots for Weekly Wrap rank-delta copy.
 * `period` reserves weekly/monthly slots; v1 only writes `all` (lifetime).
 */
export const userRankSnapshots = pgTable(
  "user_rank_snapshots",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    isoWeek: text("iso_week").notNull(),
    period: text("period").notNull().default("all"),
    rank: integer("rank").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.isoWeek, table.period] }),
  }),
);

export type UserRankSnapshot = typeof userRankSnapshots.$inferSelect;
export type InsertUserRankSnapshot = typeof userRankSnapshots.$inferInsert;

/**
 * Durable idempotency for outbound email sends. One row per logical send;
 * INSERT ON CONFLICT DO NOTHING gates duplicate Resend calls across retries
 * and deploys. Rows are backend-only (no RLS).
 */
export const emailSendLog = pgTable("email_send_log", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  userId: varchar("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  template: text("template").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export type EmailSendLog = typeof emailSendLog.$inferSelect;
export type InsertEmailSendLog = typeof emailSendLog.$inferInsert;

/**
 * Per-(user, market) mute. Composes with the category-level toggles in
 * `notificationPreferences`: a notification is delivered only if (a) the
 * user has the relevant category enabled AND (b) the market isn't on
 * the user's mute list. The row count is bounded by user activity (a
 * user only mutes markets they engage with), so we keep the data model
 * simple — no expiry, no enum of "mute kinds", just (userId, marketId).
 */
export const notificationMarketMutes = pgTable(
  "notification_market_mutes",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    marketId: varchar("market_id")
      .notNull()
      .references(() => predictionMarkets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.marketId] }),
  }),
);

export type NotificationMarketMute = typeof notificationMarketMutes.$inferSelect;
export type InsertNotificationMarketMute = typeof notificationMarketMutes.$inferInsert;

/**
 * Admin-authored broadcast notifications.
 *
 * Sits ABOVE the per-user `notifications` table — one broadcast row
 * fans out to N notification rows via `createNotificationsBulk`. The
 * link is the stable idempotency key pattern `broadcast:<id>:<userId>`,
 * so we can compute analytics (seen/read/click rates) by joining
 * `notifications.idempotencyKey LIKE 'broadcast:<id>:%'` rather than
 * snapshotting them here and risking drift.
 */
export const adminBroadcasts = pgTable("admin_broadcasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdBy: varchar("created_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  priority: integer("priority").notNull().default(1),
  category: text("category").notNull().default("system"),
  // Audience filter. See migration 0045 for the V1 shape.
  audience: jsonb("audience").notNull(),
  targetCount: integer("target_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  // 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
  status: text("status").notNull().default("draft"),
  scheduledFor: timestamp("scheduled_for"),
  sentAt: timestamp("sent_at"),
  cancelledAt: timestamp("cancelled_at"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("idx_admin_broadcasts_created_at").on(table.createdAt),
  statusIdx: index("idx_admin_broadcasts_status").on(table.status),
}));

export type AdminBroadcast = typeof adminBroadcasts.$inferSelect;
export type InsertAdminBroadcast = typeof adminBroadcasts.$inferInsert;

export type BroadcastAudienceKind =
  | "everyone"
  | "active_30d"
  | "placed_bet"
  | "category_subscribers"
  | "single_user"
  | "test_self";

export interface BroadcastAudience {
  kind: BroadcastAudienceKind;
  /** When kind === 'category_subscribers'. */
  category?: string;
  /** When kind === 'single_user'. */
  userId?: string;
}

/** Site-wide strip shown above app content (all visitors, including logged-out). */
export const siteAnnouncements = pgTable("site_announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  message: text("message").notNull(),
  href: text("href"),
  linkLabel: text("link_label"),
  linkDisplay: text("link_display").notNull().default("cta_chevron"),
  style: text("style").notNull().default("promo"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  dismissible: boolean("dismissible").notNull().default(true),
  createdBy: varchar("created_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  startsAtIdx: index("idx_site_announcements_starts_at").on(table.startsAt),
}));

export type SiteAnnouncement = typeof siteAnnouncements.$inferSelect;
export type InsertSiteAnnouncement = typeof siteAnnouncements.$inferInsert;

export type SiteBannerStyle = "info" | "promo" | "warning";
export type SiteBannerLinkDisplay = "cta_chevron" | "inline_link";

/** Product telemetry for Insights surfaces (pill clicks, quadrant taps, etc.). */
export const insightsEvents = pgTable("insights_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => profiles.id, { onDelete: "set null" }),
  surface: text("surface").notNull(),
  action: text("action").notNull(),
  params: jsonb("params").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  surfaceCreatedIdx: index("insights_events_surface_created_idx").on(table.surface, table.createdAt),
  userCreatedIdx: index("insights_events_user_created_idx").on(table.userId, table.createdAt),
}));

export type InsightsEvent = typeof insightsEvents.$inferSelect;
export type InsertInsightsEvent = typeof insightsEvents.$inferInsert;
