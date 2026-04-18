-- Composite index to support the daily-cap check in GamificationService.awardXp
-- (filters xp_ledger by user_id + action_type + created_at >= today).
-- DESC on created_at because the query targets the most recent rows first.

CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_action_date
  ON xp_ledger (user_id, action_type, created_at DESC);
