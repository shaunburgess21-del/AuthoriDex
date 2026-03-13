CREATE TYPE "public"."content_status" AS ENUM('draft', 'live', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('running', 'completed', 'failed', 'locked_out', 'skipped', 'failed_partial');--> statement-breakpoint
CREATE TYPE "public"."market_outcome" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" varchar NOT NULL,
	"admin_email" text,
	"action_type" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" varchar NOT NULL,
	"previous_data" jsonb,
	"new_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"provider" text NOT NULL,
	"person_id" varchar,
	"response_data" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "api_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "celebrity_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"image_url" text NOT NULL,
	"source" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"votes_up" integer DEFAULT 0 NOT NULL,
	"votes_down" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "celebrity_metrics" (
	"celebrity_id" varchar PRIMARY KEY NOT NULL,
	"trend_score" real DEFAULT 0,
	"fame_index" integer DEFAULT 0,
	"seed_approval_count" integer DEFAULT 0 NOT NULL,
	"seed_approval_sum" integer DEFAULT 0 NOT NULL,
	"approval_votes_count" integer DEFAULT 0 NOT NULL,
	"approval_avg_rating" real,
	"approval_pct" real,
	"seed_underrated_count" integer DEFAULT 0 NOT NULL,
	"seed_overrated_count" integer DEFAULT 0 NOT NULL,
	"seed_fairly_rated_count" integer DEFAULT 0 NOT NULL,
	"underrated_votes_count" integer DEFAULT 0 NOT NULL,
	"overrated_votes_count" integer DEFAULT 0 NOT NULL,
	"fairly_rated_votes_count" integer DEFAULT 0 NOT NULL,
	"underrated_pct" real,
	"overrated_pct" real,
	"fairly_rated_pct" real,
	"value_score" real,
	"visibility" text DEFAULT 'live' NOT NULL,
	"curate_visibility" text DEFAULT 'live' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "celebrity_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"person_name" text NOT NULL,
	"short_bio" text NOT NULL,
	"long_bio" text,
	"known_for" text NOT NULL,
	"from_country" text NOT NULL,
	"from_country_code" varchar(2) NOT NULL,
	"based_in" text NOT NULL,
	"based_in_country_code" varchar(2) NOT NULL,
	"estimated_net_worth" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "celebrity_profiles_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "celebrity_value_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"celebrity_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "celebrity_value_votes_user_id_celebrity_id_unique" UNIQUE("user_id","celebrity_id")
);
--> statement-breakpoint
CREATE TABLE "comment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_votes_user_id_comment_id_unique" UNIQUE("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "community_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text NOT NULL,
	"content" text NOT NULL,
	"sentiment_vote" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"txn_type" text NOT NULL,
	"amount" integer NOT NULL,
	"wallet_type" text DEFAULT 'VIRTUAL' NOT NULL,
	"balance_after" integer NOT NULL,
	"source" text DEFAULT 'user_action' NOT NULL,
	"compliance_status" text DEFAULT 'pending',
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "induction_candidates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"category" text NOT NULL,
	"image_slug" text,
	"seed_votes" integer DEFAULT 0 NOT NULL,
	"wiki_slug" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" "ingestion_run_status" DEFAULT 'running' NOT NULL,
	"hour_bucket" timestamp,
	"snapshots_written" integer DEFAULT 0,
	"people_processed" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"error_summary" text,
	"source_timings" jsonb,
	"source_statuses" jsonb,
	"health_summary" jsonb,
	"lock_acquired_at" timestamp,
	"lock_released_at" timestamp,
	"heartbeat_at" timestamp,
	"score_version" varchar DEFAULT 'v1'
);
--> statement-breakpoint
CREATE TABLE "insight_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" varchar NOT NULL,
	"parent_id" varchar,
	"user_id" varchar NOT NULL,
	"username" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" varchar NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"metric_value" real NOT NULL,
	"link" text,
	"image_url" text,
	"timestamp" timestamp
);
--> statement-breakpoint
CREATE TABLE "insight_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insight_votes_user_id_insight_id_unique" UNIQUE("user_id","insight_id")
);
--> statement-breakpoint
CREATE TABLE "market_bets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar NOT NULL,
	"entry_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"stake_amount" integer NOT NULL,
	"potential_payout" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"settled_at" timestamp,
	"payout_amount" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar NOT NULL,
	"entry_type" text DEFAULT 'custom' NOT NULL,
	"person_id" varchar,
	"label" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"total_stake" integer DEFAULT 0 NOT NULL,
	"resolution_status" text DEFAULT 'pending' NOT NULL,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"seed_count" integer DEFAULT 0,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "matchup_comment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mc_votes_user_comment_unique" UNIQUE("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "matchup_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matchup_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"avatar_url" text,
	"body" text NOT NULL,
	"parent_id" varchar,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "face_off_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"face_off_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"choice" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "face_off_votes_user_id_face_off_id_unique" UNIQUE("user_id","face_off_id")
);
--> statement-breakpoint
CREATE TABLE "face_offs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"option_a_text" text NOT NULL,
	"option_a_image" text,
	"option_b_text" text NOT NULL,
	"option_b_image" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"person_a_id" varchar,
	"person_b_id" varchar,
	"prompt_text" text,
	"seed_votes_a" integer DEFAULT 0 NOT NULL,
	"seed_votes_b" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'live',
	"featured" boolean DEFAULT false,
	"slug" text,
	"scheduled_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_market_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"avatar_url" text,
	"body" text NOT NULL,
	"parent_id" varchar,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opinion_poll_comment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opc_votes_user_comment_unique" UNIQUE("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "opinion_poll_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"avatar_url" text,
	"body" text NOT NULL,
	"parent_id" varchar,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opinion_poll_options" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" varchar NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"person_id" varchar,
	"order_index" integer DEFAULT 0 NOT NULL,
	"seed_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opinion_poll_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" varchar NOT NULL,
	"option_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opinion_poll_votes_user_poll_unique" UNIQUE("user_id","poll_id")
);
--> statement-breakpoint
CREATE TABLE "opinion_polls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"summary" text,
	"image_url" text,
	"featured" boolean DEFAULT false,
	"visibility" text DEFAULT 'draft',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_views" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"user_agent" text,
	"referrer" text,
	"session_id" text,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"platform" text NOT NULL,
	"insight_type" text NOT NULL,
	"metric_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_status" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_value" real,
	"last_updated_at" timestamp DEFAULT now(),
	"staleness_hours" integer DEFAULT 0,
	CONSTRAINT "platform_status_person_id_platform_unique" UNIQUE("person_id","platform")
);
--> statement-breakpoint
CREATE TABLE "prediction_markets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_type" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"rules" text,
	"metadata" jsonb,
	"start_at" timestamp DEFAULT now() NOT NULL,
	"end_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"void_reason" text,
	"created_by" varchar,
	"settled_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"open_market_type" text,
	"teaser" text,
	"description" text,
	"category" text,
	"tags" text[],
	"cover_image_url" text,
	"source_url" text,
	"featured" boolean DEFAULT false,
	"timezone" text DEFAULT 'UTC',
	"resolution_criteria" text[],
	"resolution_sources" jsonb,
	"resolution_notes" text,
	"resolve_method" text,
	"seed_participants" integer DEFAULT 0,
	"seed_volume" numeric DEFAULT '0',
	"underlying" text,
	"metric" text,
	"strike" numeric,
	"unit" text,
	"close_at" timestamp,
	"person_id" varchar,
	"is_live" boolean DEFAULT true,
	"visibility" text DEFAULT 'live',
	"inactive_message" text,
	"seed_config" jsonb,
	"week_number" integer,
	CONSTRAINT "prediction_markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" varchar PRIMARY KEY NOT NULL,
	"username" text,
	"full_name" text,
	"avatar_url" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"rank" text DEFAULT 'Citizen' NOT NULL,
	"xp_points" integer DEFAULT 0 NOT NULL,
	"predict_credits" integer DEFAULT 1000 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"total_votes" integer DEFAULT 0 NOT NULL,
	"total_predictions" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "ranks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" integer NOT NULL,
	"min_xp" integer NOT NULL,
	"max_xp" integer,
	"vote_multiplier" real DEFAULT 1 NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	CONSTRAINT "ranks_name_unique" UNIQUE("name"),
	CONSTRAINT "ranks_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint
CREATE TABLE "sentiment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"person_id" varchar NOT NULL,
	"person_name" text NOT NULL,
	"vote_type" text NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	"voted_date" text NOT NULL,
	CONSTRAINT "sentiment_votes_user_id_person_id_voted_date_unique" UNIQUE("user_id","person_id","voted_date")
);
--> statement-breakpoint
CREATE TABLE "tier1_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"x_followers" real,
	"instagram_followers" real,
	"youtube_subscribers" real,
	"tiktok_followers" real,
	"spotify_monthly_listeners" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tier1_overrides_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "tracked_people" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"avatar" text,
	"image_slug" text,
	"bio" text,
	"youtube_id" text,
	"spotify_id" text,
	"wiki_slug" text,
	"x_handle" text,
	"instagram_handle" text,
	"tiktok_handle" text,
	"search_query_override" text,
	"news_query_widened" text,
	"status" text DEFAULT 'main_leaderboard' NOT NULL,
	CONSTRAINT "tracked_people_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trend_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"news_count" real DEFAULT 0 NOT NULL,
	"youtube_views" real DEFAULT 0 NOT NULL,
	"spotify_followers" real DEFAULT 0 NOT NULL,
	"search_volume" real DEFAULT 0 NOT NULL,
	"trend_score" real NOT NULL,
	"fame_index" integer DEFAULT 0,
	"wiki_pageviews" real DEFAULT 0,
	"wiki_delta" real DEFAULT 0,
	"news_delta" real DEFAULT 0,
	"search_delta" real DEFAULT 0,
	"x_quote_velocity" real DEFAULT 0,
	"x_reply_velocity" real DEFAULT 0,
	"mass_score" real DEFAULT 0,
	"velocity_score" real DEFAULT 0,
	"velocity_adjusted" real DEFAULT 0,
	"confidence" real DEFAULT 1,
	"diversity_multiplier" real DEFAULT 1,
	"momentum" text DEFAULT 'Stable',
	"drivers" text[],
	"snapshot_origin" text DEFAULT 'ingest',
	"diagnostics" jsonb,
	"run_id" varchar NOT NULL,
	"score_version" varchar DEFAULT 'v1',
	CONSTRAINT "trend_snapshots_person_id_timestamp_unique" UNIQUE("person_id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "trending_people" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"bio" text,
	"rank" integer NOT NULL,
	"trend_score" real NOT NULL,
	"fame_index" integer DEFAULT 0,
	"fame_index_live" integer,
	"live_rank" integer,
	"live_updated_at" timestamp,
	"live_dampen" real DEFAULT 1,
	"change_24h" real,
	"change_7d" real,
	"category" text,
	"profile_views_10m" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "trending_poll_comment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tpc_votes_user_comment_unique" UNIQUE("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "trending_poll_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"avatar_url" text,
	"body" text NOT NULL,
	"parent_id" varchar,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trending_poll_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"choice" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trending_poll_votes_user_id_poll_id_unique" UNIQUE("user_id","poll_id")
);
--> statement-breakpoint
CREATE TABLE "trending_polls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"category" text NOT NULL,
	"headline" text NOT NULL,
	"subject_text" text NOT NULL,
	"person_id" varchar,
	"description" text,
	"timeline" text,
	"deadline_at" timestamp,
	"image_url" text,
	"seed_support_count" integer DEFAULT 0 NOT NULL,
	"seed_neutral_count" integer DEFAULT 0 NOT NULL,
	"seed_oppose_count" integer DEFAULT 0 NOT NULL,
	"slug" text,
	"featured" boolean DEFAULT false,
	"visibility" text DEFAULT 'draft',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_favourites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"person_id" varchar NOT NULL,
	"person_name" text NOT NULL,
	"person_avatar" text,
	"person_category" text,
	"favourited_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_favourites_user_id_person_id_unique" UNIQUE("user_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "user_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"person_id" varchar NOT NULL,
	"person_name" text NOT NULL,
	"rating" integer NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_votes_user_id_person_id_unique" UNIQUE("user_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text,
	"wallet_address" text,
	"xp_points" integer DEFAULT 0 NOT NULL,
	"reputation_rank" text DEFAULT 'Citizen' NOT NULL,
	"predict_credits" integer DEFAULT 1000 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar NOT NULL,
	"value" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"voted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_key" text NOT NULL,
	"display_name" text NOT NULL,
	"xp_value" integer NOT NULL,
	"daily_cap" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" timestamp DEFAULT now() NOT NULL,
	"expiry_date" timestamp,
	CONSTRAINT "xp_actions_action_key_unique" UNIQUE("action_key")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action_type" text NOT NULL,
	"xp_delta" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"source" text DEFAULT 'user_action' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "celebrity_images" ADD CONSTRAINT "celebrity_images_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_metrics" ADD CONSTRAINT "celebrity_metrics_celebrity_id_tracked_people_id_fk" FOREIGN KEY ("celebrity_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_value_votes" ADD CONSTRAINT "celebrity_value_votes_celebrity_id_tracked_people_id_fk" FOREIGN KEY ("celebrity_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_comment_id_insight_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."insight_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_comments" ADD CONSTRAINT "insight_comments_insight_id_community_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."community_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_items" ADD CONSTRAINT "insight_items_insight_id_platform_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."platform_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_votes" ADD CONSTRAINT "insight_votes_insight_id_community_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."community_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_bets" ADD CONSTRAINT "market_bets_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_bets" ADD CONSTRAINT "market_bets_entry_id_market_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."market_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_entries" ADD CONSTRAINT "market_entries_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_entries" ADD CONSTRAINT "market_entries_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchup_comment_votes" ADD CONSTRAINT "matchup_comment_votes_comment_id_matchup_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."matchup_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchup_comments" ADD CONSTRAINT "matchup_comments_matchup_id_face_offs_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."face_offs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_off_votes" ADD CONSTRAINT "face_off_votes_face_off_id_face_offs_id_fk" FOREIGN KEY ("face_off_id") REFERENCES "public"."face_offs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_offs" ADD CONSTRAINT "face_offs_person_a_id_tracked_people_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_offs" ADD CONSTRAINT "face_offs_person_b_id_tracked_people_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_market_comments" ADD CONSTRAINT "open_market_comments_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_comment_votes" ADD CONSTRAINT "opinion_poll_comment_votes_comment_id_opinion_poll_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."opinion_poll_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_comments" ADD CONSTRAINT "opinion_poll_comments_poll_id_opinion_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."opinion_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_options" ADD CONSTRAINT "opinion_poll_options_poll_id_opinion_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."opinion_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_options" ADD CONSTRAINT "opinion_poll_options_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_votes" ADD CONSTRAINT "opinion_poll_votes_poll_id_opinion_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."opinion_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_votes" ADD CONSTRAINT "opinion_poll_votes_option_id_opinion_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."opinion_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_insights" ADD CONSTRAINT "platform_insights_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_status" ADD CONSTRAINT "platform_status_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier1_overrides" ADD CONSTRAINT "tier1_overrides_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_snapshots" ADD CONSTRAINT "trend_snapshots_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_poll_comment_votes" ADD CONSTRAINT "trending_poll_comment_votes_comment_id_trending_poll_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."trending_poll_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_poll_comments" ADD CONSTRAINT "trending_poll_comments_poll_id_trending_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."trending_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_poll_votes" ADD CONSTRAINT "trending_poll_votes_poll_id_trending_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."trending_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_polls" ADD CONSTRAINT "trending_polls_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "celebrity_value_votes_celebrity_idx" ON "celebrity_value_votes" USING btree ("celebrity_id");--> statement-breakpoint
CREATE INDEX "celebrity_value_votes_user_idx" ON "celebrity_value_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_history_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_status_idx" ON "ingestion_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_single_running_idx" ON "ingestion_runs" USING btree ("status") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "mc_votes_comment_idx" ON "matchup_comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "matchup_comments_matchup_idx" ON "matchup_comments" USING btree ("matchup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "face_offs_slug_unique" ON "face_offs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "face_offs_slug_idx" ON "face_offs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "face_offs_visibility_idx" ON "face_offs" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "open_market_comments_market_idx" ON "open_market_comments" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "opc_votes_comment_idx" ON "opinion_poll_comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "opinion_poll_comments_poll_idx" ON "opinion_poll_comments" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "opinion_poll_options_poll_idx" ON "opinion_poll_options" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "opinion_poll_options_order_idx" ON "opinion_poll_options" USING btree ("poll_id","order_index");--> statement-breakpoint
CREATE INDEX "opinion_poll_votes_poll_idx" ON "opinion_poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "opinion_poll_votes_option_idx" ON "opinion_poll_votes" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opinion_polls_slug_unique" ON "opinion_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "opinion_polls_slug_idx" ON "opinion_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "opinion_polls_category_idx" ON "opinion_polls" USING btree ("category");--> statement-breakpoint
CREATE INDEX "opinion_polls_visibility_idx" ON "opinion_polls" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "page_views_created_at_idx" ON "page_views" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "page_views_path_idx" ON "page_views" USING btree ("path");--> statement-breakpoint
CREATE INDEX "trend_snapshots_run_id_idx" ON "trend_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tpc_votes_comment_idx" ON "trending_poll_comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "trending_poll_comments_poll_idx" ON "trending_poll_comments" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "trending_poll_votes_poll_id_idx" ON "trending_poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "trending_poll_votes_user_id_idx" ON "trending_poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trending_polls_slug_unique" ON "trending_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trending_polls_status_idx" ON "trending_polls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trending_polls_slug_idx" ON "trending_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trending_polls_category_idx" ON "trending_polls" USING btree ("category");--> statement-breakpoint
CREATE INDEX "trending_polls_person_id_idx" ON "trending_polls" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "trending_polls_deadline_at_idx" ON "trending_polls" USING btree ("deadline_at");