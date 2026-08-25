-- Oddsphere · Schema Migration V39 — NFL player-props official tracking
-- Additive service-role-only ledger. Decisions enter only after the official
-- T-60 freeze and are immutable apart from close/outcome settlement fields.

BEGIN;

CREATE TABLE IF NOT EXISTS public.nfl_player_prop_records (
  id BIGSERIAL PRIMARY KEY,
  tracking_key TEXT NOT NULL,
  provider_game_id TEXT NOT NULL,
  provider_player_id TEXT,
  player_name TEXT NOT NULL,
  team TEXT,
  market TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under', 'yes')),
  sportsbook TEXT NOT NULL,
  locked_price INTEGER NOT NULL,
  locked_probability NUMERIC(9,8) NOT NULL,
  locked_expected_value NUMERIC(9,8) NOT NULL,
  play_grade TEXT NOT NULL CHECK (play_grade IN ('Best Angle', 'Lean')),
  locked_at TIMESTAMPTZ NOT NULL,
  model_release TEXT NOT NULL,
  calibration_release TEXT NOT NULL,
  decision_release TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'win', 'loss', 'push', 'void')),
  actual_value NUMERIC,
  closing_price INTEGER,
  closing_implied_probability NUMERIC(9,8),
  clv_probability_points NUMERIC(9,6),
  settled_at TIMESTAMPTZ,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nfl_player_prop_records_tracking_release_key UNIQUE (tracking_key, decision_release)
);

CREATE INDEX IF NOT EXISTS idx_nfl_player_prop_records_game ON public.nfl_player_prop_records(provider_game_id);
CREATE INDEX IF NOT EXISTS idx_nfl_player_prop_records_player ON public.nfl_player_prop_records(provider_player_id);
CREATE INDEX IF NOT EXISTS idx_nfl_player_prop_records_pending ON public.nfl_player_prop_records(result) WHERE result = 'pending';

ALTER TABLE public.nfl_player_prop_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_player_prop_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nfl_player_prop_records TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nfl_player_prop_records_id_seq TO service_role;

COMMIT;
