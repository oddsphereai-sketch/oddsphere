-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V3 — slate_date
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   games.game_date is TIMESTAMPTZ (UTC). A North American sports "slate"
--   spans midnight UTC — a Saturday-evening MLB slate has games at 23:00Z
--   (7pm ET) AND at 01:30Z next day (10:30pm ET / 7:30pm PT). Filtering by
--   `game_date::date` (UTC) or by a UTC range buckets those games on
--   different calendar days even though they belong to the same slate in
--   ET-local terms — the way fans, analysts, and our own scores model
--   actually think about "tonight".
--
--   The Phase 4 stopgap (`gte game_date 00:00Z AND lt next-day 06:00Z`)
--   handled most North American slates but is fragile, doesn't generalize
--   to UCL (London matchday), and double-counts games at the seam.
--
--   This migration adds `games.slate_date` (DATE NOT NULL) computed from
--   `game_date` in the sport's local timezone. Routes and services switch
--   from windowed `game_date` filtering to direct `slate_date` equality.
--
-- TIMEZONE MAP
--   MLB / NBA / NFL / NHL / NCAAFB / NCAAMB → America/New_York (ET anchor)
--   UCL                                     → Europe/London (matchday)
--
--   Eastern Time is the conventional broadcast anchor for North American
--   sports and what Daniel uses when posting picks. London is the
--   conventional UEFA matchday anchor.
--
-- BACKFILL
--   For existing rows we derive slate_date from game_date + sport timezone
--   at migration time. This is idempotent — the same UTC timestamp always
--   maps to the same local date.
--
-- COMPATIBILITY
--   No columns are dropped. The legacy `game_date` TIMESTAMPTZ column is
--   preserved for display, ordering, and CLV/post-game logic. Only date
--   FILTERING moves to slate_date.
--
-- ROLLBACK
--   See verification queries at the bottom. To roll back: ALTER TABLE
--   games DROP COLUMN slate_date; DROP INDEX games_slate_date_idx;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add slate_date column (nullable for the duration of backfill) ──────
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS slate_date DATE;

COMMENT ON COLUMN games.slate_date IS
  'Local-evening date of the game in the sport''s broadcast anchor timezone (ET for North American sports, London for UCL). Use this for "tonight''s slate" filtering — not the UTC game_date.';

-- ── 2. Backfill from game_date using per-sport timezone ───────────────────
UPDATE games
SET slate_date = (
  CASE
    WHEN sport = 'ucl' THEN (game_date AT TIME ZONE 'Europe/London')::date
    ELSE (game_date AT TIME ZONE 'America/New_York')::date
  END
)
WHERE slate_date IS NULL;

-- ── 3. Lock in NOT NULL constraint ────────────────────────────────────────
ALTER TABLE games
  ALTER COLUMN slate_date SET NOT NULL;

-- ── 4. Index for "tonight's slate" lookups (sport + slate_date) ───────────
CREATE INDEX IF NOT EXISTS games_slate_date_idx
  ON games (sport, slate_date);

CREATE INDEX IF NOT EXISTS games_slate_date_recent_idx
  ON games (slate_date DESC);

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Column exists, NOT NULL, indexed:
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'games' AND column_name = 'slate_date';
--
-- 2. Backfill: no NULLs and counts match per sport:
--    SELECT sport, COUNT(*) AS games, COUNT(slate_date) AS with_slate
--    FROM games GROUP BY sport ORDER BY sport;
--
-- 3. Sanity check: late-night MLB game gets the right ET slate date.
--    Pick an MLB game at 01:00Z (≈ 9pm ET previous day):
--    SELECT external_id, game_date, slate_date
--    FROM games
--    WHERE sport = 'mlb'
--    ORDER BY external_id LIMIT 12;
--
-- 4. Sanity check: a Saturday-evening MLB slate maps all 12 games to the
--    same slate_date (the Saturday in ET):
--    SELECT slate_date, COUNT(*) AS games
--    FROM games
--    WHERE sport = 'mlb'
--      AND slate_date IN (
--        SELECT slate_date FROM games WHERE sport = 'mlb'
--        ORDER BY slate_date DESC LIMIT 3
--      )
--    GROUP BY slate_date ORDER BY slate_date DESC;
-- ═════════════════════════════════════════════════════════════════════════════
