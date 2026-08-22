-- NFL forward evidence is append-only research/operations data. It is not a
-- public prediction table and cannot publish or track a wager by itself.
CREATE TABLE IF NOT EXISTS public.nfl_forward_evidence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_release text NOT NULL,
  collector_release text NOT NULL,
  run_id uuid NOT NULL,
  season integer NOT NULL CHECK (season >= 2026),
  week integer NOT NULL CHECK (week BETWEEN 1 AND 18),
  provider_game_id text NOT NULL,
  away_team text NOT NULL,
  home_team text NOT NULL,
  game_start_at timestamptz NOT NULL,
  stage text NOT NULL CHECK (stage IN ('opening', 'unlocked', 't60')),
  captured_at timestamptz NOT NULL,
  cutoff_at timestamptz,
  payload jsonb NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_release, provider_game_id, stage, captured_at, payload_sha256)
);

-- Opening and T-60 are immutable horizons: exactly one observation per game
-- and evidence release. Unlocked observations may append throughout the week.
CREATE UNIQUE INDEX IF NOT EXISTS nfl_forward_evidence_one_opening_per_game
  ON public.nfl_forward_evidence_snapshots (evidence_release, provider_game_id)
  WHERE stage = 'opening';

CREATE UNIQUE INDEX IF NOT EXISTS nfl_forward_evidence_one_t60_per_game
  ON public.nfl_forward_evidence_snapshots (evidence_release, provider_game_id)
  WHERE stage = 't60';

CREATE INDEX IF NOT EXISTS nfl_forward_evidence_week_stage_captured
  ON public.nfl_forward_evidence_snapshots (season, week, stage, captured_at DESC);

ALTER TABLE public.nfl_forward_evidence_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nfl_forward_evidence_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.nfl_forward_evidence_snapshots TO service_role;

COMMENT ON TABLE public.nfl_forward_evidence_snapshots IS
  'Immutable NFL opening/unlocked/T-60 inputs collected by the shared prediction_pipeline:nfl lease; never a public-grade or tracking writer.';
