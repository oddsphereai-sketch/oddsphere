-- V37: private MLB player-props tracking ledger.
-- Additive only. This table is never exposed through member routes and has no
-- anon/authenticated RLS policy; all reads and writes use the service role.

CREATE TABLE IF NOT EXISTS public.mlb_prop_tracking_entries (
  id BIGSERIAL PRIMARY KEY,
  tracking_key TEXT NOT NULL UNIQUE,
  slate_date DATE NOT NULL,
  external_game_id TEXT NOT NULL,
  mlb_game_pk BIGINT NOT NULL,
  game_start_timestamp TIMESTAMPTZ NOT NULL,
  external_player_id TEXT NOT NULL,
  mlb_player_id BIGINT NOT NULL,
  bdl_player_id BIGINT,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  opponent TEXT NOT NULL,
  market_key TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  line NUMERIC NOT NULL,
  sportsbook TEXT NOT NULL,
  locked_american_odds INT NOT NULL,
  locked_model_probability NUMERIC,
  locked_market_probability NUMERIC,
  locked_final_probability NUMERIC NOT NULL,
  locked_edge NUMERIC,
  locked_expected_value NUMERIC,
  locked_fair_american_odds INT,
  play_grade TEXT NOT NULL,
  confidence_tier TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  stake_units NUMERIC NOT NULL DEFAULT 0,
  tracking_cohort TEXT NOT NULL CHECK (tracking_cohort IN ('actionable', 'model_observation')),
  model_version TEXT NOT NULL,
  board_snapshot_id TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL,
  latest_line NUMERIC,
  latest_american_odds INT,
  latest_market_probability NUMERIC,
  latest_snapshot_id TEXT,
  latest_price_timestamp TIMESTAMPTZ,
  closing_line NUMERIC,
  closing_american_odds INT,
  closing_market_probability NUMERIC,
  closing_timestamp TIMESTAMPTZ,
  clv_status TEXT NOT NULL DEFAULT 'pending',
  clv_probability_delta NUMERIC,
  clv_american_delta NUMERIC,
  result_status TEXT NOT NULL DEFAULT 'pending',
  result_value NUMERIC,
  result_units NUMERIC,
  settled_at TIMESTAMPTZ,
  settlement_provider TEXT,
  settlement_attempts INT NOT NULL DEFAULT 0,
  settlement_error TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlb_prop_tracking_slate_locked
  ON public.mlb_prop_tracking_entries (slate_date, locked_at DESC);

CREATE INDEX IF NOT EXISTS idx_mlb_prop_tracking_pending
  ON public.mlb_prop_tracking_entries (result_status, slate_date, game_start_timestamp)
  WHERE result_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mlb_prop_tracking_performance
  ON public.mlb_prop_tracking_entries (tracking_cohort, market_key, play_grade, slate_date DESC);

ALTER TABLE IF EXISTS public.prop_settlement_runs
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.mlb_prop_tracking_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mlb_prop_tracking_entries FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mlb_prop_tracking_entries_id_seq FROM anon, authenticated;
