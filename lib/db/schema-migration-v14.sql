-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V14 — identity model (provider_ids JSONB)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- FIX 7.1 (Identity model)
--
-- WHY
--   Today every entity row (teams / games / players) carries a single
--   `external_id` column sourced from BALLDONTLIE. Fix 7.1 introduces a
--   federated identity surface so that multiple providers — manual slate
--   ingestion (Fix 7.2), future SharpAPI (Phase 8), future OddsAPI fallback,
--   future automated OddSphere scores model — can each attach their own id
--   to the same canonical internal row without a schema migration per
--   provider.
--
--   The canonical internal identity remains the `id` column on each table.
--   `external_id` semantics are preserved as-is (no behavior change). The
--   new `provider_ids` JSONB column is purely additive: rows default to
--   `{}`, and existing readers / writers don't touch it.
--
--   This unblocks the manual slate provider (Fix 7.2) by giving us a place
--   to attach a "manual" key on internally-created games / teams, and a
--   place for each future provider to attach its own ids by tuple-match
--   reconciliation against rows that already exist.
--
-- SHAPE
--   3 new columns:
--     • teams.provider_ids    JSONB NOT NULL DEFAULT '{}'::jsonb
--     • games.provider_ids    JSONB NOT NULL DEFAULT '{}'::jsonb
--     • players.provider_ids  JSONB NOT NULL DEFAULT '{}'::jsonb
--
--   Each JSONB object maps a provider name (snake_case lowercase) to that
--   provider's id for the row. Values may be string or number — JSONB
--   preserves type. App-layer convention: `String(value)` on read.
--
--   Reserved key conventions (extensible — these are not DB-enforced):
--     • "balldontlie" — BALLDONTLIE.io ids (current seed provider)
--     • "sharpapi"    — future SharpAPI ids (Phase 8)
--     • "oddsapi"     — future OddsAPI ids (fallback)
--     • "manual"      — internal serial assigned by the manual-slate
--                       provider (Fix 7.2; not in scope for Fix 7.1)
--
--   3 GIN indexes for sub-millisecond containment lookups
--   (`WHERE provider_ids @> '{"sharpapi":"NYY-mlb-2026"}'`):
--     • teams_provider_ids_gin
--     • games_provider_ids_gin
--     • players_provider_ids_gin
--
-- BACKFILL
--   None. Flag B1 = no backfill in Fix 7.1. Existing rows get the column
--   default of `{}`. When SharpAPI / OddsAPI / automated providers wire up,
--   their ingestion paths attach their own ids by tuple-match reconciliation
--   (sport + abbreviation + date + home/away). The internal `id` column
--   never moves; provider attachments accumulate over time.
--
--   `external_id` semantics are unchanged — existing reads / writes
--   continue functioning. Future migrations may attach
--   `provider_ids."balldontlie" = external_id` if a code path needs it; in
--   Fix 7.1 we keep them independent so the migration is purely additive
--   with zero data touched.
--
-- COMPATIBILITY
--   ✓ Purely additive. ADD COLUMN with stored-default optimization (Postgres
--     11+) avoids any row rewrite — instant catalog update.
--   ✓ All `NOT NULL DEFAULT '{}'::jsonb`, so existing inserts that don't
--     mention the column continue to work — new rows get `{}`.
--   ✓ Existing SELECTs that don't reference `provider_ids` are unaffected.
--   ✓ Existing reads/writes via `external_id` continue working.
--   ✓ FK joins from `lines`, `sharp_signals`, `line_history`,
--     `game_predictions`, `prop_predictions`, `prediction_results`,
--     `lineups`, `weather_forecasts`, `ballparks`, `player_*_stats` are
--     unaffected — they reference `games.id` / `teams.id` / `players.id`,
--     not the new column.
--   ✓ TypeScript domain types (`Team`, `Game`, `Player`) gain a required
--     `provider_ids: ProviderIds` field; consumers that destructure the
--     row see the field as a `Record<string, string | number>`.
--   ✓ No CHECK constraints, no uniqueness constraints. Per-provider
--     partial unique indexes get added one at a time when each provider
--     is wired (e.g. `UNIQUE INDEX ON teams ((provider_ids->>'sharpapi'))
--     WHERE provider_ids ? 'sharpapi'` is a Phase 8 concern).
--
-- ROLLBACK
--   DROP INDEX IF EXISTS teams_provider_ids_gin;
--   DROP INDEX IF EXISTS games_provider_ids_gin;
--   DROP INDEX IF EXISTS players_provider_ids_gin;
--   ALTER TABLE teams   DROP COLUMN IF EXISTS provider_ids;
--   ALTER TABLE games   DROP COLUMN IF EXISTS provider_ids;
--   ALTER TABLE players DROP COLUMN IF EXISTS provider_ids;
--   (No data loss: no existing data was altered.)
--
-- NUMBERING NOTE
--   V14 follows V13 (per-pick grade columns). V9/V10 remain reserved.
--   No new gap introduced here.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add provider_ids JSONB columns ────────────────────────────────────
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Column comments (operator-facing identity convention) ─────────────
COMMENT ON COLUMN teams.provider_ids IS
  'Per-provider id attachments. Keys: snake_case provider names (balldontlie, sharpapi, oddsapi, manual, …). Values: that provider''s id for this team (string or number). Empty by default. Canonical internal identity remains teams.id.';

COMMENT ON COLUMN games.provider_ids IS
  'Per-provider id attachments. Keys: snake_case provider names (balldontlie, sharpapi, oddsapi, manual, …). Values: that provider''s id for this game (string or number). Empty by default. Canonical internal identity remains games.id.';

COMMENT ON COLUMN players.provider_ids IS
  'Per-provider id attachments. Keys: snake_case provider names (balldontlie, sharpapi, oddsapi, manual, …). Values: that provider''s id for this player (string or number). Empty by default. Canonical internal identity remains players.id.';

-- ── 3. GIN indexes for containment lookups ───────────────────────────────
-- Plain CREATE INDEX (not CONCURRENTLY) because Supabase SQL Editor wraps
-- multi-statement blocks in a transaction, and CONCURRENTLY cannot run
-- inside a transaction. At current row counts (thousands of teams/players,
-- low-tens-of-thousands of games), the brief AccessExclusiveLock during
-- index build is acceptable.
CREATE INDEX IF NOT EXISTS teams_provider_ids_gin
  ON teams USING gin(provider_ids);

CREATE INDEX IF NOT EXISTS games_provider_ids_gin
  ON games USING gin(provider_ids);

CREATE INDEX IF NOT EXISTS players_provider_ids_gin
  ON players USING gin(provider_ids);

COMMIT;
