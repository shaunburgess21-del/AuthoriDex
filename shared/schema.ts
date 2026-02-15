import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, integer, real, timestamp, unique, uniqueIndex, jsonb, serial, boolean, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const contentStatusEnum = pgEnum("content_status", ["draft", "live", "archived"]);
export const marketOutcomeEnum = pgEnum("market_outcome", ["yes", "no"]);

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
  searchQueryOverride: text("search_query_override"),
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
  snapshotOrigin: text("snapshot_origin").default("ingest"),
  diagnostics: jsonb("diagnostics"),
  runId: varchar("run_id").notNull(),
}, (table) => ({
  uniquePersonTimestamp: unique().on(table.personId, table.timestamp),
  runIdIdx: index("trend_snapshots_run_id_idx").on(table.runId),
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
  fameIndexLive: integer("fame_index_live"), // live-ticked score (blended: canonical + internal signals)
  liveRank: integer("live_rank"), // rank based on fame_index_live
  liveUpdatedAt: timestamp("live_updated_at"), // when fast-lane last ticked this person
  liveDampen: real("live_dampen").default(1.0), // dampening factor (0.5 if snap-back detected)
  change24h: real("change_24h"),
  change7d: real("change_7d"),
  category: text("category"),
  profileViews10m: integer("profile_views_10m").default(0), // view counter reset each tick
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
  personAId: varchar("person_a_id").references(() => trackedPeople.id),
  personBId: varchar("person_b_id").references(() => trackedPeople.id),
  promptText: text("prompt_text"),
  seedVotesA: integer("seed_votes_a").notNull().default(0),
  seedVotesB: integer("seed_votes_b").notNull().default(0),
  scheduledAt: timestamp("scheduled_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  slug: text("slug").unique(),
  featured: boolean("featured").default(false),
  visibility: text("visibility").default("draft"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
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

// ============================================================================
// TRENDING POLL COMMENTS — Discussion on poll detail pages
// ============================================================================

export const trendingPollComments = pgTable("trending_poll_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull().references(() => trendingPolls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  body: text("body").notNull(),
  parentId: varchar("parent_id"),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pollIdx: index("trending_poll_comments_poll_idx").on(table.pollId),
}));

export const insertTrendingPollCommentSchema = createInsertSchema(trendingPollComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  upvotes: true,
  downvotes: true,
});

export type TrendingPollComment = typeof trendingPollComments.$inferSelect;
export type InsertTrendingPollComment = z.infer<typeof insertTrendingPollCommentSchema>;

export const trendingPollCommentVotes = pgTable("trending_poll_comment_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => trendingPollComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  voteType: text("vote_type").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserComment: unique("tpc_votes_user_comment_unique").on(table.userId, table.commentId),
  commentIdx: index("tpc_votes_comment_idx").on(table.commentId),
}));

export type TrendingPollCommentVote = typeof trendingPollCommentVotes.$inferSelect;

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
  seedParticipants: integer("seed_participants").default(0), // Display seed for social proof
  seedVolume: numeric("seed_volume").default("0"), // Display seed for pool volume
  underlying: text("underlying"), // For updown: e.g. "Bitcoin", "S&P 500"
  metric: text("metric"), // For updown: e.g. "price", "market cap"
  strike: numeric("strike"), // For updown: the strike value
  unit: text("unit"), // For updown: e.g. "$", "pts"
  closeAt: timestamp("close_at"), // When betting closes (can differ from endAt/resolution)
  personId: varchar("person_id"), // Linked celebrity (optional)
  isLive: boolean("is_live").default(true), // Legacy - use visibility instead
  visibility: text("visibility").default("live"), // draft | live | inactive | archived
  inactiveMessage: text("inactive_message"), // Custom message shown on inactive cards (e.g. "Coming Soon")
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
  seedCount: integer("seed_count").default(0), // Display seed for social proof on this entry
  imageUrl: text("image_url"), // Avatar/image for this entry (manual URL or resolved from linked person)
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

// Open Market Comments - Discussion on Real-World Markets (marketType='community')
export const openMarketComments = pgTable("open_market_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  body: text("body").notNull(),
  parentId: varchar("parent_id"),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  marketIdx: index("open_market_comments_market_idx").on(table.marketId),
}));

export const insertOpenMarketCommentSchema = createInsertSchema(openMarketComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  upvotes: true,
  downvotes: true,
});

export type OpenMarketComment = typeof openMarketComments.$inferSelect;
export type InsertOpenMarketComment = z.infer<typeof insertOpenMarketCommentSchema>;

export const openMarketCommentsRelations = relations(openMarketComments, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [openMarketComments.marketId],
    references: [predictionMarkets.id],
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
  // Approval SEED aggregates (pre-launch baseline, no fake users)
  seedApprovalCount: integer("seed_approval_count").notNull().default(0),
  seedApprovalSum: integer("seed_approval_sum").notNull().default(0), // sum of ratings (count * avg_rating)
  // Approval DISPLAY aggregates (seed + real votes combined)
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

export const ingestionRunStatusEnum = pgEnum("ingestion_run_status", ["running", "completed", "failed", "locked_out"]);

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
