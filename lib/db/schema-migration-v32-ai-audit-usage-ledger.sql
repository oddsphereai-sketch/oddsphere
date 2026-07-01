-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V32 — AI audit usage ledger
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS ai_audit_usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  month_key TEXT NOT NULL,
  sport TEXT,
  slate_date DATE,
  game_id TEXT,
  audit_scope TEXT,
  payload_hash TEXT,
  from_cache BOOLEAN DEFAULT FALSE,
  skipped_reason TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  cached_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  actual_cost_usd NUMERIC(10,6),
  status TEXT,
  severity TEXT,
  recommended_actions JSONB,
  escalation BOOLEAN DEFAULT FALSE,
  escalation_parent_id UUID REFERENCES ai_audit_usage_ledger(id),
  applied BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_usage_ledger_month
  ON ai_audit_usage_ledger(month_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_usage_ledger_game
  ON ai_audit_usage_ledger(game_id, payload_hash);

CREATE OR REPLACE VIEW ai_audit_usage_monthly_summary AS
SELECT
  month_key,
  COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0)::NUMERIC(12,6) AS total_spend_usd,
  COUNT(*) FILTER (WHERE from_cache IS NOT TRUE AND skipped_reason IS NULL) AS calls_month,
  COUNT(*) FILTER (WHERE from_cache IS TRUE) AS cache_hits,
  COUNT(*) FILTER (WHERE status = 'pass') AS pass_count,
  COUNT(*) FILTER (WHERE status = 'warn') AS warn_count,
  COUNT(*) FILTER (WHERE status = 'block') AS block_count,
  COUNT(*) FILTER (WHERE escalation IS TRUE) AS mini_escalation_count,
  JSONB_OBJECT_AGG(sport, spend_by_sport) FILTER (WHERE sport IS NOT NULL) AS spend_by_sport,
  JSONB_OBJECT_AGG(model, spend_by_model) FILTER (WHERE model IS NOT NULL) AS spend_by_model
FROM (
  SELECT
    l.*,
    SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)) OVER (PARTITION BY month_key, sport) AS spend_by_sport,
    SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)) OVER (PARTITION BY month_key, model) AS spend_by_model
  FROM ai_audit_usage_ledger l
) x
GROUP BY month_key;

COMMIT;

