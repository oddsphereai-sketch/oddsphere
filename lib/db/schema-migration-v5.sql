-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V5 — teams.logo_url
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   The Daily Edge card and other team-displaying surfaces currently render
--   team abbreviations only (e.g., "NYY @ BOS"). Adding logos makes the
--   product feel less like a spreadsheet and more like a real betting tool.
--
--   For MLB in V1 we use the official mlbstatic CDN:
--     https://www.mlbstatic.com/team-logos/{external_id}-72.png
--   Same URL pattern works in BALLDONTLIE responses (Phase 7), so the column
--   structure stays stable across the mock → real swap.
--
-- SHAPE
--   logo_url TEXT, NULLABLE. The Daily Edge card falls back to abbreviation
--   when null — gracefully no-ops for sports/teams not yet populated.
--
-- ROLLBACK
--   ALTER TABLE teams DROP COLUMN logo_url;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN teams.logo_url IS
  'CDN URL for the team logo. MLB: https://www.mlbstatic.com/team-logos/{external_id}-72.png. NULL when no logo is available (yet) — UI falls back to abbreviation.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification (run after BEGIN..COMMIT succeeds):
--
-- 1. Column exists:
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'teams' AND column_name = 'logo_url';
--
-- 2. After running `npm run seed`:
--    SELECT sport, COUNT(*) AS total, COUNT(logo_url) AS with_logo
--    FROM teams GROUP BY sport ORDER BY sport;
-- ═════════════════════════════════════════════════════════════════════════════
