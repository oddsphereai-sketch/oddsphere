-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V15 — manual_slate_staging (Fix 7.2)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- FIX 7.2 (Manual slate provider — admin slate upload bridge)
--
-- WHY
--   V1 launches before paid sports APIs (SharpAPI, OddsAPI, BallDontLie Live)
--   are connected. Production today has zero games because the only path that
--   creates `games` rows is `slateService.refreshGames(sport, date)` calling
--   `IPlayerStatsProvider.getGames`, which is mock-only. Fix 6.1's
--   production-visible `source_type='manual'` cannot land because there are
--   no games to attach predictions to.
--
--   Fix 7.2 introduces `manual_slate_staging` as the durable audit table for
--   admin slate uploads. Each row captures one admin POST to
--   /api/admin/upload-slate. The new `ManualSlateProvider` reads from this
--   table at ingest time, resolving abbreviation references against the
--   pre-seeded `teams` table (Fix 7.1's identity foundation) to produce
--   `SlateGameRecord`s that `slateService.refreshGames` UPSERTs into `games`
--   with `provider_ids.manual = "<sport>:<date>:<home_abbrev>:<away_abbrev>"`.
--
--   The staging table is the source-of-truth audit log for every manual
--   upload — kept indefinitely (Flag G1) for forensic / debugging value
--   regardless of whether the ingest succeeded or was later overridden.
--
-- SHAPE
--   1 new table: manual_slate_staging
--     id              BIGSERIAL primary key
--     sport           TEXT       — one of 7 valid Sport keys
--     slate_date      DATE       — the slate's local-evening date
--     payload         JSONB      — admin-supplied games array (validated by
--                                  route before insert; provider re-validates
--                                  abbrev refs against teams at ingest)
--     status          TEXT       — 'pending' | 'ingested' | 'failed'
--                                  ('pending' on insert; route's inline refresh
--                                   updates to 'ingested'/'failed')
--     created_by      TEXT       — admin email from request header (audit)
--     created_at      TIMESTAMPTZ
--     ingested_at     TIMESTAMPTZ
--     ingest_result   JSONB      — { records_updated, skipped[], errors[]? }
--
--   3 indexes:
--     • (sport, slate_date DESC)  — primary lookup: "latest slate for sport"
--     • status WHERE status='pending'  — partial; small/fast cleanup queries
--     • GIN(payload)              — containment lookups on game payloads
--
-- PAYLOAD SHAPE (informational — DB stores as opaque JSONB)
--   {
--     games: [
--       {
--         home_team_abbrev: "NYY",
--         away_team_abbrev: "BOS",
--         game_date: "2026-05-28T23:05:00.000Z",
--         season: 2026,
--         season_type: "regular",     // optional
--         venue: "Yankee Stadium",    // optional
--         notes: "doubleheader g1"    // optional
--       },
--       ...
--     ]
--   }
--
--   ManualSlateProvider expects this shape; route validates before insert.
--
-- COMPATIBILITY
--   ✓ Purely additive — new table only. No changes to existing schema.
--   ✓ Existing reads/writes against games, teams, players, predictions
--     unchanged. The route + ManualSlateProvider only INSERT into the new
--     staging table and UPSERT into games via existing slateService logic.
--   ✓ provider_ids attachment uses Fix 7.1's V14 column — no further DDL
--     required for identity-model integration.
--   ✓ Idempotent: re-running the migration is a no-op via IF NOT EXISTS.
--     Re-uploading the same slate is idempotent at the games level because
--     external_id is a deterministic hash of (sport, date, home, away) +
--     UPSERT key is (sport, external_id) (Flag D1). The staging table
--     records every upload attempt for audit history.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS manual_slate_staging;
--   (Cascades nothing — no FKs reference this table.)
--   To also remove the manually-created games:
--   DELETE FROM games WHERE provider_ids ? 'manual';
--
-- NUMBERING NOTE
--   V15 follows V14 (provider_ids JSONB). V9/V10 remain reserved. No new
--   gap introduced.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Manual slate staging table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_slate_staging (
  id              BIGSERIAL   PRIMARY KEY,
  sport           TEXT        NOT NULL,
  slate_date      DATE        NOT NULL,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ingested', 'failed')),
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at     TIMESTAMPTZ,
  ingest_result   JSONB
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS manual_slate_staging_sport_date_idx
  ON manual_slate_staging (sport, slate_date DESC);

CREATE INDEX IF NOT EXISTS manual_slate_staging_status_idx
  ON manual_slate_staging (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS manual_slate_staging_payload_gin
  ON manual_slate_staging USING gin(payload);

-- ── 3. Table + column comments (operator-facing docs) ────────────────────
COMMENT ON TABLE manual_slate_staging IS
  'Fix 7.2 — admin-uploaded slates before paid sports APIs land. Each row captures one admin POST to /api/admin/upload-slate. ManualSlateProvider reads the latest non-failed row for (sport, slate_date) at ingest time, OR a specific row id when the upload route passes a provider override.';

COMMENT ON COLUMN manual_slate_staging.payload IS
  'JSONB { games: [{home_team_abbrev, away_team_abbrev, game_date, season, season_type?, venue?, notes?}, ...] }. Abbreviations are validated by the upload route against the teams table for the chosen sport; unknown abbreviations fail with a helpful error before this row is inserted.';

COMMENT ON COLUMN manual_slate_staging.status IS
  'pending = inserted but slateService.refreshGames has not been called yet (transient — route calls refresh inline); ingested = refresh succeeded; failed = refresh threw an error. Status is updated by the route after the inline refresh completes.';

COMMENT ON COLUMN manual_slate_staging.ingest_result IS
  'JSONB capture of slateService.refreshGames output: { records_updated: number, skipped: number[]?, errors: string[]? }. Forensic value: lets us reconstruct what each upload actually wrote to games even months later.';

COMMIT;
