-- AI Auditor Evaluation Lab
-- Stores full structured replay outputs by run_id for offline quality analysis.
-- This table is replay/evaluation only. It does not mutate predictions,
-- recommendations, users, subscriptions, tracking, or member-facing card data.

CREATE TABLE IF NOT EXISTS public.ai_audit_evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  audit_scope TEXT NOT NULL DEFAULT 'historical_replay_quality_paid_sample',
  ledger_id UUID REFERENCES public.ai_audit_usage_ledger(id) ON DELETE SET NULL,
  applied BOOLEAN NOT NULL DEFAULT FALSE,

  sport TEXT NOT NULL,
  slate_date DATE NOT NULL,
  game_id TEXT NOT NULL,
  external_id BIGINT,
  matchup TEXT,
  market TEXT NOT NULL,
  payload_hash TEXT NOT NULL,

  original_pick TEXT,
  original_grade TEXT,
  original_market_read TEXT,
  original_model_probability NUMERIC,
  original_edge NUMERIC,
  original_price NUMERIC,
  original_recommendation_confidence NUMERIC,

  ai_recommended_grade TEXT,
  ai_recommended_market_read TEXT,
  ai_recommendation_direction TEXT,
  downgrade_promotion_reason TEXT,

  data_integrity_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  market_read_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  play_grade_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  betting_value_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  card_coherence_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  market_reviews JSONB NOT NULL DEFAULT '[]'::jsonb,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  issue_materiality_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  recommended_actions TEXT[] NOT NULL DEFAULT '{}',
  safe_copy_fixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  repair_actions TEXT[] NOT NULL DEFAULT '{}',
  full_ai_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors TEXT[] NOT NULL DEFAULT '{}',

  postgame_result_joined BOOLEAN NOT NULL DEFAULT FALSE,
  postgame_result TEXT,
  units NUMERIC,
  roi NUMERIC,
  odds_american NUMERIC,

  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC,
  model TEXT,
  status TEXT,
  severity TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_eval_results_run
  ON public.ai_audit_evaluation_results(run_id, slate_date, game_id, market);

CREATE INDEX IF NOT EXISTS idx_ai_audit_eval_results_variant
  ON public.ai_audit_evaluation_results(variant, slate_date);

CREATE INDEX IF NOT EXISTS idx_ai_audit_eval_results_payload
  ON public.ai_audit_evaluation_results(payload_hash, market);

CREATE INDEX IF NOT EXISTS idx_ai_audit_eval_results_ledger
  ON public.ai_audit_evaluation_results(ledger_id);

ALTER TABLE IF EXISTS public.ai_audit_evaluation_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_audit_eval_results_no_client_select
  ON public.ai_audit_evaluation_results;
DROP POLICY IF EXISTS ai_audit_eval_results_no_client_insert
  ON public.ai_audit_evaluation_results;
DROP POLICY IF EXISTS ai_audit_eval_results_no_client_update
  ON public.ai_audit_evaluation_results;
DROP POLICY IF EXISTS ai_audit_eval_results_no_client_delete
  ON public.ai_audit_evaluation_results;

CREATE POLICY ai_audit_eval_results_no_client_select
  ON public.ai_audit_evaluation_results
  FOR SELECT
  TO anon, authenticated
  USING (FALSE);

CREATE POLICY ai_audit_eval_results_no_client_insert
  ON public.ai_audit_evaluation_results
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (FALSE);

CREATE POLICY ai_audit_eval_results_no_client_update
  ON public.ai_audit_evaluation_results
  FOR UPDATE
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE POLICY ai_audit_eval_results_no_client_delete
  ON public.ai_audit_evaluation_results
  FOR DELETE
  TO anon, authenticated
  USING (FALSE);

REVOKE ALL ON TABLE public.ai_audit_evaluation_results FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_audit_evaluation_results TO service_role;
