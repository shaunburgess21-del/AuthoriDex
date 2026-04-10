UPDATE "face_offs"
SET
  "seed_votes_a" = GREATEST(0, ("seed_votes_a" * 7) / 10),
  "seed_votes_b" = GREATEST(0, ("seed_votes_b" * 7) / 10),
  "seed_votes_neutral" = GREATEST(0, ("seed_votes_neutral" * 7) / 10);
