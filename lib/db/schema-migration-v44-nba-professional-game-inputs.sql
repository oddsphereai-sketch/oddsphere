-- Immutable finalized-game inputs for the NBA professional point-in-time model.
-- Additive only. Existing locks, predictions, ratings, and shadow captures are
-- untouched. Service-role readers/writers only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.nba_professional_game_inputs (
  id                    BIGSERIAL PRIMARY KEY,
  collector_release     TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider = 'balldontlie'),
  provider_game_id      BIGINT NOT NULL,
  season                INT NOT NULL,
  game_started_at       TIMESTAMPTZ NOT NULL,
  home_provider_team_id BIGINT NOT NULL,
  away_provider_team_id BIGINT NOT NULL,
  home_team_abbreviation TEXT NOT NULL,
  away_team_abbreviation TEXT NOT NULL,
  game_json             JSONB NOT NULL,
  home_box_json         JSONB NOT NULL,
  away_box_json         JSONB NOT NULL,
  captured_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (collector_release, provider_game_id)
);

CREATE INDEX IF NOT EXISTS idx_nba_professional_game_inputs_season_time
  ON public.nba_professional_game_inputs (season, game_started_at);

ALTER TABLE public.nba_professional_game_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nba_professional_game_inputs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.nba_professional_game_inputs TO service_role;

COMMENT ON TABLE public.nba_professional_game_inputs IS
  'Append-only finalized BALLDONTLIE game and aggregate team-box inputs for replaying the released NBA point-in-time model. Existing rows are immutable.';

COMMIT;
