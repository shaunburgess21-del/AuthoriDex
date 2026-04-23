-- Curate Profile vote cleanup:
--   1) Remove historical 'down' rows written by the now-deleted client auto-downvote loop.
--   2) Reset denormalized votes_down counters on celebrity_images.
--   3) Constrain image_votes.direction to only accept 'up' going forward.
-- Order matters: data cleanup must run BEFORE the CHECK constraint is added,
-- otherwise ALTER TABLE fails on the existing 'down' rows.

DELETE FROM "image_votes" WHERE "direction" = 'down';--> statement-breakpoint
UPDATE "celebrity_images" SET "votes_down" = 0 WHERE "votes_down" <> 0;--> statement-breakpoint
ALTER TABLE "image_votes" ADD CONSTRAINT "image_votes_direction_check" CHECK ("direction" IN ('up'));
