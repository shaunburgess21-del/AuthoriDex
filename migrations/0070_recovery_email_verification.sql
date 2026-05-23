-- Pending OTP state for recovery-email verification (Account settings).
-- Hashes and expiry are cleared after successful verify or when the
-- recovery address is removed/changed.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "recovery_email_verify_code_hash" text,
  ADD COLUMN IF NOT EXISTS "recovery_email_verify_expires_at" timestamp;
