-- Data update, not a schema change.
--
-- referral_completed stays 5,000 Vox, once per friend (ledger key
-- referral_<referee id>). This sets the per-referrer UTC-day cap to 3
-- so adjustCredits enforces it inside the referrer's profile lock.
-- Friends past the cap are not dropped: the app keeps them unpaid
-- (no ledger row) and pays the oldest pending one on a later day.
--
-- Runs once via schema_migrations. Do not re-apply by hand after an
-- admin has edited this row — a re-run would reset their cap.
-- The payout amount column is intentionally untouched.

UPDATE credit_actions
SET daily_cap = 3,
    notes = 'Awarded to the referrer when the referred user completes their first meaningful action. Capped per referrer per UTC day; friends past the cap stay queued and pay on a later day, once each.',
    updated_at = now()
WHERE key = 'referral_completed';
