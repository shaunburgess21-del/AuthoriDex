ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "simulation_profile" jsonb;
