-- V36: MLB player props paper-trading and provider contract hardening.
-- Additive only. Does not alter Daily Edge, tracking, grading, lock snapshots,
-- auth, subscriptions, or existing member-facing prediction tables.

CREATE TABLE IF NOT EXISTS public.prop_scoring_runs (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL DEFAULT 'mlb',
  slate_date DATE NOT NULL,
  provider_mode TEXT NOT NULL,
  odds_provider TEXT,
  stats_provider TEXT,
  context_provider TEXT,
  mlb_provider TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'started',
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  persisted BOOLEAN NOT NULL DEFAULT FALSE,
  publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  display_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  games_seen INT NOT NULL DEFAULT 0,
  markets_seen INT NOT NULL DEFAULT 0,
  odds_snapshots_seen INT NOT NULL DEFAULT 0,
  feature_snapshots_written INT NOT NULL DEFAULT 0,
  predictions_written INT NOT NULL DEFAULT 0,
  edges_written INT NOT NULL DEFAULT 0,
  recommendations_written INT NOT NULL DEFAULT 0,
  data_quality_events_written INT NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_scoring_runs_slate_created
  ON public.prop_scoring_runs (sport, slate_date, created_at DESC);

ALTER TABLE IF EXISTS public.prop_scoring_runs
  ADD COLUMN IF NOT EXISTS stats_provider TEXT,
  ADD COLUMN IF NOT EXISTS context_provider TEXT;

CREATE TABLE IF NOT EXISTS public.provider_entity_mappings (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  oddsphere_entity_id TEXT,
  provider TEXT NOT NULL,
  provider_entity_id TEXT NOT NULL,
  normalized_name TEXT,
  team_id TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_entity_mappings_unique_active
  ON public.provider_entity_mappings (entity_type, provider, provider_entity_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_provider_entity_mappings_name_team
  ON public.provider_entity_mappings (entity_type, normalized_name, team_id)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS public.prop_settlement_runs (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL DEFAULT 'mlb',
  slate_date DATE NOT NULL,
  provider TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'started',
  games_settled INT NOT NULL DEFAULT 0,
  props_settled INT NOT NULL DEFAULT 0,
  pushes INT NOT NULL DEFAULT 0,
  unresolved INT NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_settlement_runs_slate_created
  ON public.prop_settlement_runs (sport, slate_date, created_at DESC);

ALTER TABLE IF EXISTS public.recommended_bets
  ADD COLUMN IF NOT EXISTS result_status TEXT,
  ADD COLUMN IF NOT EXISTS result_units NUMERIC,
  ADD COLUMN IF NOT EXISTS clv_status TEXT,
  ADD COLUMN IF NOT EXISTS clv_value NUMERIC,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_recommended_bets_status_created
  ON public.recommended_bets (recommendation_status, created_at DESC);
