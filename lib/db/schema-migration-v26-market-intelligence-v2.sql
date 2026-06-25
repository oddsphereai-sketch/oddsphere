-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V26 — Market Intelligence v2 shadow foundation
-- ═════════════════════════════════════════════════════════════════════════════
--
-- PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- Additive shadow tables for source-aware market intelligence. These tables do
-- not replace `sharp_signals`, `lines`, `line_history`, prediction tables, or
-- Daily Edge DTOs. They are append-only observation/audit lanes for v2 feature
-- development behind:
--   MARKET_INTELLIGENCE_V2_ENABLED=false
--   MARKET_INTELLIGENCE_V2_UI_ENABLED=false
--   MARKET_SPLITS_MODEL_MODE=shadow
--
-- Rollback is pure DROP TABLE at the bottom.

BEGIN;

CREATE TABLE IF NOT EXISTS market_split_observations_v2 (
  id                         BIGSERIAL PRIMARY KEY,
  canonical_event_id          TEXT NOT NULL,
  canonical_market_id         TEXT NOT NULL,
  league                      TEXT NOT NULL,
  market_type                 TEXT NOT NULL,
  selection_key               TEXT NOT NULL,
  provider                    TEXT NOT NULL,
  source_book                 TEXT NOT NULL,
  source_type                 TEXT NOT NULL,
  bets_pct                    NUMERIC(8,6),
  money_pct                   NUMERIC(8,6),
  market_line                 NUMERIC,
  market_price                INTEGER,
  books_used                  INTEGER,
  provider_event_id           TEXT,
  source_observed_at          TIMESTAMPTZ,
  fetched_at                  TIMESTAMPTZ NOT NULL,
  source_timestamp_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  minutes_to_start            INTEGER,
  raw_payload_hash            TEXT NOT NULL,
  raw_payload                 JSONB,
  inserted_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_split_observations_v2_market_chk
    CHECK (market_type IN ('moneyline', 'spread', 'total')),
  CONSTRAINT market_split_observations_v2_provider_chk
    CHECK (provider IN ('playbook', 'sharpapi')),
  CONSTRAINT market_split_observations_v2_source_book_chk
    CHECK (source_book IN ('consensus', 'draftkings', 'circa', 'betmgm')),
  CONSTRAINT market_split_observations_v2_source_type_chk
    CHECK (source_type IN ('multi_book_consensus', 'retail_book', 'sharp_adjacent_book')),
  CONSTRAINT market_split_observations_v2_bets_pct_chk
    CHECK (bets_pct IS NULL OR (bets_pct >= 0 AND bets_pct <= 1)),
  CONSTRAINT market_split_observations_v2_money_pct_chk
    CHECK (money_pct IS NULL OR (money_pct >= 0 AND money_pct <= 1)),
  CONSTRAINT market_split_observations_v2_not_empty_chk
    CHECK (bets_pct IS NOT NULL OR money_pct IS NOT NULL),
  CONSTRAINT market_split_observations_v2_unique_payload
    UNIQUE (provider, source_book, canonical_event_id, canonical_market_id, selection_key, raw_payload_hash)
);

CREATE INDEX IF NOT EXISTS market_split_observations_v2_lookup_idx
  ON market_split_observations_v2 (league, canonical_event_id, market_type, selection_key, fetched_at DESC);

CREATE INDEX IF NOT EXISTS market_split_observations_v2_distribution_idx
  ON market_split_observations_v2 (provider, source_book, league, market_type, minutes_to_start, fetched_at DESC);

COMMENT ON TABLE market_split_observations_v2 IS
  'Append-only canonical split observations for Market Intelligence v2 shadow mode. '
  'Percentages are normalized 0..1. Missing values stay NULL, never 0.50. '
  'Playbook is consensus only; SharpAPI split sources remain source-specific.';

CREATE TABLE IF NOT EXISTS market_price_observations_v2 (
  id                         BIGSERIAL PRIMARY KEY,
  canonical_event_id          TEXT NOT NULL,
  canonical_market_id         TEXT NOT NULL,
  league                      TEXT NOT NULL,
  sportsbook                  TEXT NOT NULL,
  sharp_book                  BOOLEAN NOT NULL DEFAULT FALSE,
  market_type                 TEXT NOT NULL,
  selection_key               TEXT NOT NULL,
  line                        NUMERIC,
  american_price              INTEGER,
  decimal_price               NUMERIC,
  no_vig_probability          NUMERIC(8,6),
  provider_timestamp          TIMESTAMPTZ,
  fetched_at                  TIMESTAMPTZ NOT NULL,
  minutes_to_start            INTEGER,
  inserted_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_price_observations_v2_market_chk
    CHECK (market_type IN ('moneyline', 'spread', 'total')),
  CONSTRAINT market_price_observations_v2_probability_chk
    CHECK (no_vig_probability IS NULL OR (no_vig_probability >= 0 AND no_vig_probability <= 1)),
  CONSTRAINT market_price_observations_v2_unique_price
    UNIQUE (canonical_market_id, sportsbook, selection_key, line, american_price, provider_timestamp)
);

CREATE INDEX IF NOT EXISTS market_price_observations_v2_lookup_idx
  ON market_price_observations_v2 (canonical_event_id, market_type, selection_key, sportsbook, fetched_at DESC);

CREATE INDEX IF NOT EXISTS market_price_observations_v2_sharp_idx
  ON market_price_observations_v2 (league, market_type, fetched_at DESC)
  WHERE sharp_book = TRUE;

COMMENT ON TABLE market_price_observations_v2 IS
  'Append-only canonical price observations for Market Intelligence v2 shadow mode. '
  'Provider timestamps are freshness timestamps unless separately verified; movement must be computed from distinct stored prices.';

CREATE TABLE IF NOT EXISTS market_intelligence_snapshots_v2 (
  id                         BIGSERIAL PRIMARY KEY,
  canonical_event_id          TEXT NOT NULL,
  canonical_market_id         TEXT NOT NULL,
  selection_key               TEXT NOT NULL,
  league                      TEXT NOT NULL,
  market_type                 TEXT NOT NULL,
  resolver_version            TEXT NOT NULL,
  score                       INTEGER NOT NULL,
  label                       TEXT NOT NULL,
  explanation                 TEXT NOT NULL,
  evidence_json               JSONB NOT NULL,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_intelligence_snapshots_v2_score_chk
    CHECK (score >= -5 AND score <= 5)
);

CREATE INDEX IF NOT EXISTS market_intelligence_snapshots_v2_lookup_idx
  ON market_intelligence_snapshots_v2 (canonical_event_id, market_type, selection_key, generated_at DESC);

COMMIT;

-- ROLLBACK:
--   DROP TABLE IF EXISTS market_intelligence_snapshots_v2;
--   DROP TABLE IF EXISTS market_price_observations_v2;
--   DROP TABLE IF EXISTS market_split_observations_v2;
