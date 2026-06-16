-- ═════════════════════════════════════════════════════════════════════════════
-- Cleanup: clear alternate-line pollution from the streaming caches (2026-06-16)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL — run in the Supabase SQL editor with the worker OFF
--     (STREAM_WORKER_ENABLED=false). NOT auto-applied.
--
-- WHY: before the alternate-line fix, alternate totals/spreads overwrote the
-- main line in odds_current_stream and produced fake rows in line_movements
-- (e.g. total 9.0 → 11.0 = +2.0). Both tables are caches/logs that the worker
-- repopulates cleanly once re-enabled on the fixed build, so the safe cleanup
-- is a full truncate of those two tables only.
--
-- PRESERVES odds_events_raw (append-only audit/replay). The fixed worker tags
-- alternate raw rows with is_alternate=TRUE going forward.

BEGIN;

-- (0) REQUIRED before re-enabling the fixed worker: v24 was already applied
-- (the worker wrote to these tables), so odds_events_raw predates the new
-- is_alternate column. The fixed writer inserts is_alternate on every raw row,
-- so the column MUST exist or raw writes will fail. Idempotent — safe to re-run.
ALTER TABLE odds_events_raw
  ADD COLUMN IF NOT EXISTS is_alternate BOOLEAN NOT NULL DEFAULT FALSE;

-- Wipe the polluted caches (they rebuild from the live stream after re-enable).
TRUNCATE TABLE line_movements;
TRUNCATE TABLE odds_current_stream;

-- odds_events_raw is intentionally PRESERVED.
--
-- Optional: if you also want to drop the alternate raw rows written during the
-- pre-fix window (pre-fix rows have is_alternate=FALSE because the column
-- didn't exist / defaulted false), scope by time instead, e.g.:
--   DELETE FROM odds_events_raw WHERE received_at < '2026-06-17T00:00:00Z';
-- (Leave commented unless you specifically want to prune raw history.)

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- After running: redeploy/enable the worker on the fixed build. New writes to
-- odds_current_stream / line_movements will be MAIN-LINE ONLY; alternates land
-- in odds_events_raw with is_alternate=TRUE.
-- ═════════════════════════════════════════════════════════════════════════════
