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
ALTER TABLE "image_flags" ADD CONSTRAINT "image_flags_image_id_celebrity_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."celebrity_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_flags_resolved_created_idx" ON "image_flags" USING btree ("resolved","created_at");