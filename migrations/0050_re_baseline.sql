CREATE TYPE "public"."comment_parent_type" AS ENUM('community_insight', 'matchup', 'trending_poll', 'opinion_poll', 'open_market');--> statement-breakpoint
CREATE TYPE "public"."comment_vote_type" AS ENUM('up', 'down');--> statement-breakpoint
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
CREATE TABLE "admin_broadcasts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" varchar,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"priority" integer DEFAULT 1 NOT NULL,
	"category" text DEFAULT 'system' NOT NULL,
	"audience" jsonb NOT NULL,
	"target_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"sent_at" timestamp,
	"cancelled_at" timestamp,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_broadcasts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"display_name" text NOT NULL,
	"username" text NOT NULL,
	"bio" text,
	"archetype" text NOT NULL,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"boldness" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"contrarianism" numeric(3, 2) DEFAULT '0.30' NOT NULL,
	"recency_weight" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"prestige_bias" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"confidence_cal" numeric(3, 2) DEFAULT '0.70' NOT NULL,
	"risk_appetite" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"consensus_sensitivity" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"activity_rate" numeric(3, 2) DEFAULT '0.60' NOT NULL,
	"simulation_profile" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"memory_type" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_performance" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_entered" integer DEFAULT 0 NOT NULL,
	"total_resolved" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"avg_brier_score" numeric(6, 4),
	"accuracy" numeric(5, 4),
	"category_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"beat_crowd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_perf_agent_period_unique" UNIQUE("agent_id","period_start","period_end")
);
--> statement-breakpoint
CREATE TABLE "anon_vote_budget" (
	"fdx_sid" text NOT NULL,
	"surface_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anon_vote_budget_fdx_sid_surface_type_target_id_pk" PRIMARY KEY("fdx_sid","surface_type","target_id"),
	CONSTRAINT "anon_vote_budget_surface_check" CHECK ("anon_vote_budget"."surface_type" IN ('matchup_poll','opinion_poll','induction','trending_poll','celebrity_person'))
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
CREATE TABLE "approval_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"approval_avg_rating" real,
	"approval_votes_count" integer DEFAULT 0,
	"approval_pct" real
);
--> statement-breakpoint
CREATE TABLE "card_related_people" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_type" text NOT NULL,
	"card_id" varchar NOT NULL,
	"person_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"prompt_version" integer DEFAULT 1 NOT NULL,
	"source_hash" text,
	"source_urls" text[],
	"confidence" real,
	"as_of_date" text,
	"validation_notes" text[],
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
CREATE TABLE "comment_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"reporter_id" varchar NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" "comment_vote_type" NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_votes_user_comment_unique" UNIQUE("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" "comment_parent_type" NOT NULL,
	"parent_id" varchar NOT NULL,
	"parent_comment_id" varchar,
	"user_id" varchar NOT NULL,
	"body" text NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"sentiment_vote" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_categories" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
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
CREATE TABLE "email_unsubscribe_state" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"channel" text DEFAULT 'marketing_lifecycle' NOT NULL,
	"source" text DEFAULT 'email_link' NOT NULL,
	"token_hash" text,
	"unsubscribed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_flags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_flags_image_user_uniq" UNIQUE("image_id","user_id"),
	CONSTRAINT "image_flags_reason_check" CHECK ("image_flags"."reason" IN ('wrong_person','low_quality','inappropriate','duplicate','other'))
);
--> statement-breakpoint
CREATE TABLE "image_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"direction" text NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_votes_user_image_uniq" UNIQUE("user_id","image_id"),
	CONSTRAINT "image_votes_direction_check" CHECK ("image_votes"."direction" IN ('up'))
);
--> statement-breakpoint
CREATE TABLE "induction_candidates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"category" text NOT NULL,
	"image_slug" text,
	"seed_votes" integer DEFAULT 0 NOT NULL,
	"wiki_slug" text,
	"x_handle" text,
	"instagram_handle" text,
	"tiktok_handle" text,
	"youtube_id" text,
	"spotify_id" text,
	"search_query_override" text,
	"google_trends_topic_id" text,
	"induction_status" text DEFAULT 'Queue' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "induction_cycle_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_close_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"candidate_id" varchar,
	"person_id" varchar,
	"vote_total_at_close" integer,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "induction_cycle_results_week_close_at_unique" UNIQUE("week_close_at")
);
--> statement-breakpoint
CREATE TABLE "induction_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "induction_votes_user_candidate_uniq" UNIQUE("user_id","candidate_id")
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
	"agent_id" varchar,
	"confidence" numeric(3, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"bet_metadata" jsonb,
	"direction" text DEFAULT 'yes' NOT NULL
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
	"image_url" text,
	"no_stake" integer DEFAULT 0 NOT NULL
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
	"description" text,
	"seed_votes_a" integer DEFAULT 0 NOT NULL,
	"seed_votes_b" integer DEFAULT 0 NOT NULL,
	"seed_votes_neutral" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'live',
	"featured" boolean DEFAULT false,
	"slug" text,
	"scheduled_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_market_mutes" (
	"user_id" varchar NOT NULL,
	"market_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_market_mutes_user_id_market_id_pk" PRIMARY KEY("user_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"predictions_in_app" boolean DEFAULT true NOT NULL,
	"favorites_in_app" boolean DEFAULT true NOT NULL,
	"social_in_app" boolean DEFAULT true NOT NULL,
	"account_in_app" boolean DEFAULT true NOT NULL,
	"system_in_app" boolean DEFAULT true NOT NULL,
	"predictions_email" boolean DEFAULT false NOT NULL,
	"favorites_email" boolean DEFAULT false NOT NULL,
	"social_email" boolean DEFAULT false NOT NULL,
	"account_email" boolean DEFAULT false NOT NULL,
	"system_email" boolean DEFAULT false NOT NULL,
	"predictions_push" boolean DEFAULT false NOT NULL,
	"favorites_push" boolean DEFAULT false NOT NULL,
	"social_push" boolean DEFAULT false NOT NULL,
	"account_push" boolean DEFAULT false NOT NULL,
	"system_push" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"actor_user_id" varchar,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"group_key" text,
	"idempotency_key" text NOT NULL,
	"seen_at" timestamp,
	"read_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_idempotency_unique" UNIQUE("user_id","idempotency_key")
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
	"display_order" integer DEFAULT 0 NOT NULL,
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
	"country" text,
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
	"underlying" text,
	"metric" text,
	"strike" numeric,
	"unit" text,
	"close_at" timestamp,
	"person_id" varchar,
	"is_live" boolean DEFAULT true,
	"visibility" text DEFAULT 'live',
	"inactive_message" text,
	"week_number" integer,
	"tie_rule" text DEFAULT 'refund',
	"cadence" text DEFAULT 'weekly',
	"baseline_score" integer,
	"resolution_summary" text,
	"cms_display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "prediction_markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profile_item_privacy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" varchar PRIMARY KEY NOT NULL,
	"username" text,
	"full_name" text,
	"avatar_url" text,
	"avatar_seed" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"rank" text DEFAULT 'Citizen' NOT NULL,
	"xp_points" integer DEFAULT 0 NOT NULL,
	"predict_credits" integer DEFAULT 1000 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"total_votes" integer DEFAULT 0 NOT NULL,
	"total_predictions" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"is_agent" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp,
	"tos_accepted_at" timestamp,
	"stated_interests" text[] DEFAULT '{}' NOT NULL,
	"interests_prompt_dismissed_at" timestamp,
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
	"description" text,
	CONSTRAINT "ranks_name_unique" UNIQUE("name"),
	CONSTRAINT "ranks_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint
CREATE TABLE "scheduled_agent_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"market_id" varchar NOT NULL,
	"entry_id" varchar NOT NULL,
	"action_type" text DEFAULT 'predict' NOT NULL,
	"decision_payload" jsonb NOT NULL,
	"stake_amount" integer DEFAULT 100 NOT NULL,
	"execute_after" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"executed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"submitted_by" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"approved_as_id" text,
	"approved_as_type" text,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"google_trends_topic_id" text,
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
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_category_engagement" (
	"user_id" varchar NOT NULL,
	"category_id" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"bet_weight" numeric(10, 3) DEFAULT '0' NOT NULL,
	"first_engaged_at" timestamp DEFAULT now() NOT NULL,
	"last_engaged_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_category_engagement_user_id_category_id_pk" PRIMARY KEY("user_id","category_id")
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
CREATE TABLE "vote_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar NOT NULL,
	"action_kind" text NOT NULL,
	"prev_value" text,
	"next_value" text,
	"source" text DEFAULT 'unknown' NOT NULL,
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "votes_user_target_uniq" UNIQUE("user_id","vote_type","target_type","target_id")
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
ALTER TABLE "admin_broadcasts" ADD CONSTRAINT "admin_broadcasts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_performance" ADD CONSTRAINT "agent_performance_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_snapshots" ADD CONSTRAINT "approval_snapshots_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_related_people" ADD CONSTRAINT "card_related_people_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_images" ADD CONSTRAINT "celebrity_images_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_metrics" ADD CONSTRAINT "celebrity_metrics_celebrity_id_tracked_people_id_fk" FOREIGN KEY ("celebrity_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_profiles" ADD CONSTRAINT "celebrity_profiles_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebrity_value_votes" ADD CONSTRAINT "celebrity_value_votes_celebrity_id_tracked_people_id_fk" FOREIGN KEY ("celebrity_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_insights" ADD CONSTRAINT "community_insights_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_unsubscribe_state" ADD CONSTRAINT "email_unsubscribe_state_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_flags" ADD CONSTRAINT "image_flags_image_id_celebrity_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."celebrity_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_votes" ADD CONSTRAINT "image_votes_image_id_celebrity_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."celebrity_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "induction_cycle_results" ADD CONSTRAINT "induction_cycle_results_candidate_id_induction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."induction_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "induction_cycle_results" ADD CONSTRAINT "induction_cycle_results_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "induction_votes" ADD CONSTRAINT "induction_votes_candidate_id_induction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."induction_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_items" ADD CONSTRAINT "insight_items_insight_id_platform_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."platform_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_votes" ADD CONSTRAINT "insight_votes_insight_id_community_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."community_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_bets" ADD CONSTRAINT "market_bets_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_bets" ADD CONSTRAINT "market_bets_entry_id_market_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."market_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_entries" ADD CONSTRAINT "market_entries_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_entries" ADD CONSTRAINT "market_entries_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_off_votes" ADD CONSTRAINT "face_off_votes_face_off_id_face_offs_id_fk" FOREIGN KEY ("face_off_id") REFERENCES "public"."face_offs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_offs" ADD CONSTRAINT "face_offs_person_a_id_tracked_people_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."tracked_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_offs" ADD CONSTRAINT "face_offs_person_b_id_tracked_people_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."tracked_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_market_mutes" ADD CONSTRAINT "notification_market_mutes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_market_mutes" ADD CONSTRAINT "notification_market_mutes_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_options" ADD CONSTRAINT "opinion_poll_options_poll_id_opinion_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."opinion_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_options" ADD CONSTRAINT "opinion_poll_options_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_votes" ADD CONSTRAINT "opinion_poll_votes_poll_id_opinion_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."opinion_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinion_poll_votes" ADD CONSTRAINT "opinion_poll_votes_option_id_opinion_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."opinion_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_insights" ADD CONSTRAINT "platform_insights_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_status" ADD CONSTRAINT "platform_status_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_item_privacy" ADD CONSTRAINT "profile_item_privacy_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_entry_id_market_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."market_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_submitted_by_profiles_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier1_overrides" ADD CONSTRAINT "tier1_overrides_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_snapshots" ADD CONSTRAINT "trend_snapshots_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_poll_votes" ADD CONSTRAINT "trending_poll_votes_poll_id_trending_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."trending_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_polls" ADD CONSTRAINT "trending_polls_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_broadcasts_created_at" ON "admin_broadcasts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_broadcasts_status" ON "admin_broadcasts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_memory_agent_created_idx" ON "agent_memory" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_performance_agent_idx" ON "agent_performance" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "anon_vote_budget_sid_idx" ON "anon_vote_budget" USING btree ("fdx_sid");--> statement-breakpoint
CREATE INDEX "anon_vote_budget_created_idx" ON "anon_vote_budget" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_cache_provider_idx" ON "api_cache" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "approval_snapshots_person_ts_idx" ON "approval_snapshots" USING btree ("person_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "card_related_people_unique_idx" ON "card_related_people" USING btree ("card_type","card_id","person_id");--> statement-breakpoint
CREATE INDEX "card_related_people_person_idx" ON "card_related_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "card_related_people_card_idx" ON "card_related_people" USING btree ("card_type","card_id");--> statement-breakpoint
CREATE INDEX "celebrity_images_person_idx" ON "celebrity_images" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "celebrity_metrics_approval_idx" ON "celebrity_metrics" USING btree ("approval_avg_rating");--> statement-breakpoint
CREATE INDEX "celebrity_metrics_value_idx" ON "celebrity_metrics" USING btree ("value_score");--> statement-breakpoint
CREATE INDEX "celebrity_value_votes_celebrity_idx" ON "celebrity_value_votes" USING btree ("celebrity_id");--> statement-breakpoint
CREATE INDEX "celebrity_value_votes_user_idx" ON "celebrity_value_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comment_reports_comment_idx" ON "comment_reports" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_reports_reporter_idx" ON "comment_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "comment_votes_comment_idx" ON "comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "comments_parent_comment_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_history_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "image_flags_resolved_created_idx" ON "image_flags" USING btree ("resolved","created_at");--> statement-breakpoint
CREATE INDEX "induction_cycle_results_week_close_at_idx" ON "induction_cycle_results" USING btree ("week_close_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_status_idx" ON "ingestion_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_single_running_idx" ON "ingestion_runs" USING btree ("status") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "market_bets_market_status_idx" ON "market_bets" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "market_bets_user_status_idx" ON "market_bets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "market_bets_entry_idx" ON "market_bets" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "market_entries_market_idx" ON "market_entries" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "face_offs_slug_unique" ON "face_offs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "face_offs_slug_idx" ON "face_offs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "face_offs_visibility_idx" ON "face_offs" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_kind_idx" ON "notifications" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_category_idx" ON "notifications" USING btree ("user_id","category","created_at");--> statement-breakpoint
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
CREATE INDEX "prediction_markets_status_end_idx" ON "prediction_markets" USING btree ("status","end_at");--> statement-breakpoint
CREATE INDEX "prediction_markets_person_idx" ON "prediction_markets" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_item_privacy_user_item_unique" ON "profile_item_privacy" USING btree ("user_id","item_type","item_id");--> statement-breakpoint
CREATE INDEX "profile_item_privacy_by_user_idx" ON "profile_item_privacy" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saa_pending_idx" ON "scheduled_agent_actions" USING btree ("status","execute_after");--> statement-breakpoint
CREATE INDEX "saa_agent_market_idx" ON "scheduled_agent_actions" USING btree ("agent_id","market_id");--> statement-breakpoint
CREATE INDEX "sentiment_votes_person_idx" ON "sentiment_votes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "suggestions_submitter_idx" ON "suggestions" USING btree ("submitted_by","created_at");--> statement-breakpoint
CREATE INDEX "suggestions_status_idx" ON "suggestions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "suggestions_type_status_idx" ON "suggestions" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "tracked_people_status_idx" ON "tracked_people" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trend_snapshots_run_id_idx" ON "trend_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "trend_snapshots_person_ts_idx" ON "trend_snapshots" USING btree ("person_id","timestamp");--> statement-breakpoint
CREATE INDEX "trend_snapshots_person_origin_ts_idx" ON "trend_snapshots" USING btree ("person_id","snapshot_origin","timestamp");--> statement-breakpoint
CREATE INDEX "trending_people_rank_idx" ON "trending_people" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "trending_people_category_idx" ON "trending_people" USING btree ("category");--> statement-breakpoint
CREATE INDEX "trending_poll_votes_poll_id_idx" ON "trending_poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "trending_poll_votes_user_id_idx" ON "trending_poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trending_polls_slug_unique" ON "trending_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trending_polls_status_idx" ON "trending_polls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trending_polls_slug_idx" ON "trending_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trending_polls_category_idx" ON "trending_polls" USING btree ("category");--> statement-breakpoint
CREATE INDEX "trending_polls_person_id_idx" ON "trending_polls" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "trending_polls_deadline_at_idx" ON "trending_polls" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "user_category_engagement_user_id_idx" ON "user_category_engagement" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_category_engagement_user_last_engaged_idx" ON "user_category_engagement" USING btree ("user_id","last_engaged_at");--> statement-breakpoint
CREATE INDEX "user_votes_person_id_idx" ON "user_votes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "user_votes_person_rating_idx" ON "user_votes" USING btree ("person_id","rating");--> statement-breakpoint
CREATE INDEX "vote_actions_user_created_idx" ON "vote_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "vote_actions_type_created_idx" ON "vote_actions" USING btree ("vote_type","created_at");--> statement-breakpoint
CREATE INDEX "vote_actions_target_created_idx" ON "vote_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "votes_target_idx" ON "votes" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_xp_ledger_user_action_date" ON "xp_ledger" USING btree ("user_id","action_type","created_at");