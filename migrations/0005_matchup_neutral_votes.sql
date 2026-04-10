ALTER TABLE "face_offs" ADD COLUMN IF NOT EXISTS "seed_votes_neutral" integer NOT NULL DEFAULT 0;
