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
CREATE TABLE "image_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"direction" text NOT NULL,
	"voted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_votes_user_image_uniq" UNIQUE("user_id","image_id")
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
ALTER TABLE "market_bets" ADD COLUMN "agent_id" varchar;--> statement-breakpoint
ALTER TABLE "market_bets" ADD COLUMN "confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "market_bets" ADD COLUMN "bet_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "face_offs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD COLUMN "tie_rule" text DEFAULT 'refund';--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD COLUMN "cadence" text DEFAULT 'weekly';--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD COLUMN "baseline_score" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_performance" ADD CONSTRAINT "agent_performance_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_votes" ADD CONSTRAINT "image_votes_image_id_celebrity_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."celebrity_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "induction_votes" ADD CONSTRAINT "induction_votes_candidate_id_induction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."induction_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_actions" ADD CONSTRAINT "scheduled_agent_actions_entry_id_market_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."market_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memory_agent_created_idx" ON "agent_memory" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_performance_agent_idx" ON "agent_performance" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "saa_pending_idx" ON "scheduled_agent_actions" USING btree ("status","execute_after");--> statement-breakpoint
CREATE INDEX "saa_agent_market_idx" ON "scheduled_agent_actions" USING btree ("agent_id","market_id");