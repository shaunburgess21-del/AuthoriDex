-- Serper News disambiguation for ambiguous short names (Lisa, Rosé).
UPDATE tracked_people
SET search_query_override = 'Lisa BLACKPINK'
WHERE name = 'Lisa (Blackpink)'
  AND (search_query_override IS NULL OR btrim(search_query_override) = '');

UPDATE tracked_people
SET search_query_override = 'Rosé BLACKPINK'
WHERE name = 'Rosé'
  AND (search_query_override IS NULL OR btrim(search_query_override) = '');

UPDATE induction_candidates
SET search_query_override = 'Lisa BLACKPINK'
WHERE display_name = 'Lisa (Blackpink)'
  AND (search_query_override IS NULL OR btrim(search_query_override) = '');

UPDATE induction_candidates
SET search_query_override = 'Rosé BLACKPINK'
WHERE display_name = 'Rosé'
  AND (search_query_override IS NULL OR btrim(search_query_override) = '');
