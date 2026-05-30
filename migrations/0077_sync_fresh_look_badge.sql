-- Sync Fresh Look badge display copy with shared/badge-config.ts
UPDATE badges
SET
  name = 'Fresh Look',
  description = 'Change your avatar after signing up'
WHERE key = 'avatar_uploaded';
