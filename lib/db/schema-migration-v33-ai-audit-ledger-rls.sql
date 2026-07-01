-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V33 — AI audit ledger RLS hardening
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Keep the AI audit ledger readable/writable only through server-side
--   admin code that uses the Supabase service role. Browser clients should
--   never query audit ledger rows or spend summaries directly.

BEGIN;

ALTER TABLE IF EXISTS ai_audit_usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_audit_usage_ledger_no_client_select
  ON ai_audit_usage_ledger;
DROP POLICY IF EXISTS ai_audit_usage_ledger_no_client_insert
  ON ai_audit_usage_ledger;
DROP POLICY IF EXISTS ai_audit_usage_ledger_no_client_update
  ON ai_audit_usage_ledger;
DROP POLICY IF EXISTS ai_audit_usage_ledger_no_client_delete
  ON ai_audit_usage_ledger;

CREATE POLICY ai_audit_usage_ledger_no_client_select
  ON ai_audit_usage_ledger
  FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE POLICY ai_audit_usage_ledger_no_client_insert
  ON ai_audit_usage_ledger
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY ai_audit_usage_ledger_no_client_update
  ON ai_audit_usage_ledger
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY ai_audit_usage_ledger_no_client_delete
  ON ai_audit_usage_ledger
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- Do not expose the admin summary view to browser/API-key clients.
REVOKE ALL ON TABLE ai_audit_usage_ledger FROM anon, authenticated;
REVOKE ALL ON ai_audit_usage_monthly_summary FROM anon, authenticated;

-- The server-side admin API uses the service role and should remain able
-- to read/write the ledger and read the summary view.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_audit_usage_ledger TO service_role;
GRANT SELECT ON ai_audit_usage_monthly_summary TO service_role;

COMMIT;
