-- Backfill induction_status for promoted candidates left as inactive Queue rows.
UPDATE induction_candidates ic
SET induction_status = 'Inducted'
WHERE ic.is_active = false
  AND ic.induction_status = 'Queue'
  AND EXISTS (
    SELECT 1
    FROM tracked_people tp
    WHERE tp.name = ic.display_name
      AND tp.status = 'main_leaderboard'
  );

-- Archive orphan inactive candidates with no tracked_people shadow row.
UPDATE induction_candidates ic
SET induction_status = 'Archived'
WHERE ic.is_active = false
  AND ic.induction_status = 'Queue'
  AND NOT EXISTS (
    SELECT 1
    FROM tracked_people tp
    WHERE tp.name = ic.display_name
  );
