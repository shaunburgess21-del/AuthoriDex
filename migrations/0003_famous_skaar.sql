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
ALTER TABLE "market_bets" ADD COLUMN "direction" text DEFAULT 'yes' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_entries" ADD COLUMN "no_stake" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_snapshots" ADD CONSTRAINT "approval_snapshots_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_related_people" ADD CONSTRAINT "card_related_people_person_id_tracked_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."tracked_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_snapshots_person_ts_idx" ON "approval_snapshots" USING btree ("person_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "card_related_people_unique_idx" ON "card_related_people" USING btree ("card_type","card_id","person_id");--> statement-breakpoint
CREATE INDEX "card_related_people_person_idx" ON "card_related_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "card_related_people_card_idx" ON "card_related_people" USING btree ("card_type","card_id");--> statement-breakpoint
CREATE INDEX "user_votes_person_id_idx" ON "user_votes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "user_votes_person_rating_idx" ON "user_votes" USING btree ("person_id","rating");