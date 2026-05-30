-- XP row for Community Member badge grant (25 XP, lifetime-once per user).
INSERT INTO xp_actions (
  action_key,
  display_name,
  xp_value,
  daily_cap,
  description,
  is_active
)
VALUES (
  'community_member',
  'Community Member',
  25,
  NULL,
  'One-time XP for adding age, gender, and country of residence',
  true
)
ON CONFLICT (action_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  xp_value = EXCLUDED.xp_value,
  daily_cap = EXCLUDED.daily_cap,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;
