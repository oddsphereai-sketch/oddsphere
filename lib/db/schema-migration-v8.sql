-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V8 — games.slate_status
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   V2.1 Part 9 (Publish/Draft Protection) requires that a slate go through
--   an explicit lifecycle before it surfaces to members. Admin loads picks
--   into a "draft" slate, previews them, then promotes the whole slate to
--   "published" — at which point member-facing queries start returning it.
--   After all games finalize, slatePublishService flips the slate to "final"
--   so it stops appearing on the live Daily Edge. "hidden" is the escape
--   hatch for retracting a bad slate without dropping rows.
--
--   This is the first migration that lives on the games table (V3 added
--   slate_date there too). Until 6.3d's slatePublishService ships, this
--   column is purely advisory — nothing filters on it yet. Existing rows
--   default to 'draft' which is intentionally restrictive: the slate
--   publish service in 6.3d will promote them to 'published' as part of
--   its first run, and from then on every new slate explicitly transitions
--   draft → published.
--
-- SHAPE
--   slate_status TEXT, NOT NULL, DEFAULT 'draft'. CHECK constraint on the
--   4-value V2.1 vocabulary: draft / published / final / hidden.
--
-- COMPATIBILITY
--   ⚠️ Existing rows backfill to 'draft' (the column default). Member-facing
--   reads in 6.3a do NOT filter on slate_status yet — they still surface
--   every game — so this is safe at apply time. The actual filter lands in
--   6.3d's slatePublishService, and its first-run script will batch-promote
--   any 'draft' slate older than a cutoff to 'published' to avoid hiding
--   already-shipped data.
--
-- ROLLBACK
--   ALTER TABLE games DROP COLUMN slate_status;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS slate_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE games
  DROP CONSTRAINT IF EXISTS games_slate_status_chk;
ALTER TABLE games
  ADD CONSTRAINT games_slate_status_chk
  CHECK (slate_status IN ('draft', 'published', 'final', 'hidden'));

COMMENT ON COLUMN games.slate_status IS
  'Publish lifecycle for the slate this game belongs to. draft = admin loaded, not visible to members; published = live on Daily Edge / Player Props; final = all games settled, kept for tracking but hidden from live views; hidden = retracted (escape hatch). Filtered by slatePublishService (Phase 6.3d) — read paths in 6.3a do not filter on this column yet.';

-- Index for the eventual member-facing query: WHERE slate_status IN ('published', 'final')
CREATE INDEX IF NOT EXISTS games_slate_status_idx
  ON games (slate_status);

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Column exists with the right defaults:
--    SELECT column_name, data_type, column_default, is_nullable
--    FROM information_schema.columns
--    WHERE table_name = 'games' AND column_name = 'slate_status';
--
-- 2. CHECK constraint registered:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname = 'games_slate_status_chk';
--
-- 3. All existing rows defaulted to 'draft' (6.3d promotes them):
--    SELECT slate_status, COUNT(*) AS games
--    FROM games GROUP BY slate_status ORDER BY slate_status;
--
-- 4. Bad value rejected (this should ERROR):
--    UPDATE games SET slate_status = 'archived' WHERE id = (SELECT id FROM games LIMIT 1);
-- ═════════════════════════════════════════════════════════════════════════════
