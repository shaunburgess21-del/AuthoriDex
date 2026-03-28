-- Idempotent additive schema for induction_candidates (migration 0004).

ALTER TABLE induction_candidates ADD COLUMN IF NOT EXISTS x_handle text;

ALTER TABLE induction_candidates ADD COLUMN IF NOT EXISTS induction_status text DEFAULT 'Queue' NOT NULL;
