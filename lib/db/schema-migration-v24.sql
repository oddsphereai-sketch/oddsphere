-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V24 — SharpAPI WebSocket streaming foundation
-- (Live market-intelligence layer · streaming alongside the polling cron)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file is the documented migration for the operator to review BEFORE
-- running it. Apply via the production apply plan at the bottom.
--
-- WHY
--   We added SharpAPI WebSocket streaming. A persistent external worker
--   consumes the live `odds` channel and needs places to (1) append every
--   accepted tick for audit/replay, (2) hold the latest live price per
--   book/side, (3) log meaningful movement for the trigger engine, and
--   (4) report stream health. The existing cron-owned tables (`lines`,
--   `line_history`, `sharp_signals`) are intentionally LEFT ALONE so the
--   cron's delicate per-(game,market,book) preservation + opener-flag logic
--   keeps working byte-for-byte. Streaming writes its own tables; the
--   member-facing reads overlay them on the cron tables only when fresher.
--
-- WHAT (additive only)
--   New tables:
--     1. odds_events_raw      — append log of every accepted WS tick
--     2. odds_current_stream  — latest live price per (game,market,book,side)
--     3. line_movements       — compact movement log (trigger-engine input)
--     4. stream_health        — per-(provider,sport) connection/health counters
--   NO new columns. The "First Published" line is stored per-market in the
--     existing game_predictions.sport_specific JSONB (`posted_lines`) — see
--     section 5. CLV uses the existing bet_odds_american /
--     closing_odds_american / clv_pct / beat_closing_line columns.
--
-- SAFETY
--   • Additive only. Four new CREATE TABLE (no ALTERs on existing tables).
--     Zero changes to existing rows, constraints, cron behavior, lock logic,
--     prediction, or tracking. If the stream tables stay empty, every read
--     degrades cleanly to the existing cron path.
--   • All tables are idempotent: odds_events_raw dedups on payload_hash;
--     odds_current_stream + stream_health upsert on their unique keys.
--   • Rollback at the bottom.
--
-- RETENTION (owner guardrail)
--   odds_events_raw grows fast even with worker-side dedup + throttle. NO
--   auto-purge is wired in v1 (we keep all data while validating the model
--   and building the backtest replay). TODO: once backtest replay no longer
--   needs the long tail, add a cleanup cron (or pg_partman monthly partitions
--   on received_at) to drop rows older than ~30–60 days. Tracked so it is not
--   forgotten.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Raw append log — every accepted tick (audit / replay / backtest source).
CREATE TABLE IF NOT EXISTS odds_events_raw (
  id                   BIGSERIAL PRIMARY KEY,
  provider             TEXT NOT NULL DEFAULT 'sharpapi_ws',
  provider_event_id    TEXT,
  sport                TEXT NOT NULL,
  league               TEXT,
  game_id              BIGINT REFERENCES games(id) ON DELETE CASCADE,  -- null when unresolved
  external_id          BIGINT,
  home_team_id         BIGINT REFERENCES teams(id),
  away_team_id         BIGINT REFERENCES teams(id),
  sportsbook           TEXT NOT NULL,
  market_type          TEXT NOT NULL,
  side                 TEXT,
  line_value           DECIMAL(7,2),
  odds_american        INT,
  odds_decimal         DECIMAL(6,3),
  implied_probability  DECIMAL(5,4),
  provider_ts          TIMESTAMPTZ,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_hash         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'accepted',
  CONSTRAINT odds_events_raw_status_chk
    CHECK (status IN ('accepted', 'unresolved', 'blocked_book', 'dropped')),
  CONSTRAINT odds_events_raw_dedup UNIQUE (payload_hash)
);

COMMENT ON TABLE odds_events_raw IS
  'Append log of every accepted SharpAPI WebSocket odds tick. Idempotent via '
  'payload_hash (sha256 of the normalized tuple, never the api key). Source '
  'for replay/backtest + CLV closing-line approximation. Retention TODO: '
  'cleanup cron / partitioning on received_at once replay no longer needs the tail.';

CREATE INDEX IF NOT EXISTS odds_events_raw_game_market_idx
  ON odds_events_raw (game_id, market_type, side);
CREATE INDEX IF NOT EXISTS odds_events_raw_received_idx
  ON odds_events_raw (received_at DESC);

-- 2. Current live snapshot — one row per (game, market, book, side); upsert on tick.
CREATE TABLE IF NOT EXISTS odds_current_stream (
  id                   BIGSERIAL PRIMARY KEY,
  game_id              BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market_type          TEXT NOT NULL,
  sportsbook           TEXT NOT NULL,
  side                 TEXT NOT NULL,
  line_value           DECIMAL(7,2),
  odds_american        INT,
  odds_decimal         DECIMAL(6,3),
  implied_probability  DECIMAL(5,4),
  provider_ts          TIMESTAMPTZ,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT odds_current_stream_key UNIQUE (game_id, market_type, sportsbook, side)
);

COMMENT ON TABLE odds_current_stream IS
  'Latest live price per (game, market, book, side) from the WS worker. '
  'Separate from cron-owned `lines` so the cron preservation path is '
  'untouched; daily-edge overlays this on `lines` only when fresher.';

CREATE INDEX IF NOT EXISTS odds_current_stream_game_market_idx
  ON odds_current_stream (game_id, market_type);

-- 3. Materialized movement log — trigger-engine input (NOT for UI display).
CREATE TABLE IF NOT EXISTS line_movements (
  id                    BIGSERIAL PRIMARY KEY,
  game_id               BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market_type           TEXT NOT NULL,
  sportsbook            TEXT NOT NULL,
  side                  TEXT NOT NULL,
  prev_odds_american    INT,
  next_odds_american    INT,
  prev_line_value       DECIMAL(7,2),
  next_line_value       DECIMAL(7,2),
  delta_cents           INT,
  delta_novig_pp        DECIMAL(6,3),
  delta_points          DECIMAL(5,2),
  crossed_key_number    BOOLEAN DEFAULT FALSE,
  direction_vs_pick     TEXT,             -- 'toward' / 'against' / 'neutral' / null (pre-pick)
  moved_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE line_movements IS
  'Compact per-(game,market,side,book) movement log written by the WS worker, '
  'consumed by the meaningful-movement trigger engine. UI line-movement '
  'display still derives from line_history + odds_current_stream.';

CREATE INDEX IF NOT EXISTS line_movements_game_market_idx
  ON line_movements (game_id, market_type, moved_at DESC);

-- 4. Stream / staleness health — one row per (provider, sport); upsert.
CREATE TABLE IF NOT EXISTS stream_health (
  id                  BIGSERIAL PRIMARY KEY,
  provider            TEXT NOT NULL DEFAULT 'sharpapi_ws',
  sport               TEXT NOT NULL,
  connected           BOOLEAN NOT NULL DEFAULT FALSE,
  last_connect_at     TIMESTAMPTZ,
  last_heartbeat_at   TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,
  last_global_seq     BIGINT,
  messages_total      BIGINT NOT NULL DEFAULT 0,
  writes_total        BIGINT NOT NULL DEFAULT 0,
  recompute_calls     BIGINT NOT NULL DEFAULT 0,
  error_count         BIGINT NOT NULL DEFAULT 0,
  reconnect_count     BIGINT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stream_health_key UNIQUE (provider, sport)
);

COMMENT ON TABLE stream_health IS
  'Per-(provider,sport) WebSocket worker health: connect/heartbeat/message '
  'timestamps + counters. Powers staleness monitoring and the "is the stream '
  'live or are we on cron fallback" check before enabling live recomputes.';

-- 5. "First Published" line — NO DDL.
--    A game_predictions row is one-per-game, but the First Published price is
--    PER MARKET (ML / total / first-inning picked side). A single column can't
--    represent three markets, so First Published is stored per-market in the
--    existing game_predictions.sport_specific JSONB under `posted_lines`:
--
--      sport_specific.posted_lines = {
--        moneyline:     { american: -132, at: "2026-06-16T13:02:00Z" },
--        total:         { american: -110, at: "2026-06-16T13:02:00Z" },
--        first_inning:  { american:  120, at: "2026-06-16T13:02:00Z" }
--      }
--
--    Written set-if-null by the prediction writer on first publish (re-runs
--    never overwrite). No schema change needed — JSONB already exists. The
--    daily-edge route reads it via readPostedLines(). CLV continues to use the
--    existing bet_odds_american / closing_odds_american / clv_pct /
--    beat_closing_line columns on game_predictions + prediction_records.

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed) — pure table drops; no game_predictions columns added.
--   DROP TABLE IF EXISTS stream_health;
--   DROP TABLE IF EXISTS line_movements;
--   DROP TABLE IF EXISTS odds_current_stream;
--   DROP TABLE IF EXISTS odds_events_raw;
-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
