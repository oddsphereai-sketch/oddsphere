-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V35 — Lab response snapshots
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Store fully rendered Lab API payloads after cron/model refreshes so
--   member-facing Daily Edge and Tracking pages can cold-start with one
--   indexed row read instead of rebuilding the full response under load.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lab_response_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('daily_edge', 'tracking', 'mlb_props_board', 'mlb_props_player')),
  sport TEXT,
  slate_date DATE,
  payload JSONB NOT NULL,
  payload_version TEXT NOT NULL DEFAULT 'v1',
  source TEXT NOT NULL DEFAULT 'cron',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  stale_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_response_snapshots_kind_sport_date
  ON public.lab_response_snapshots(kind, sport, slate_date);

CREATE INDEX IF NOT EXISTS idx_lab_response_snapshots_expiry
  ON public.lab_response_snapshots(expires_at, stale_until);

ALTER TABLE IF EXISTS public.lab_response_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_response_snapshots_no_client_select
  ON public.lab_response_snapshots;
DROP POLICY IF EXISTS lab_response_snapshots_no_client_insert
  ON public.lab_response_snapshots;
DROP POLICY IF EXISTS lab_response_snapshots_no_client_update
  ON public.lab_response_snapshots;
DROP POLICY IF EXISTS lab_response_snapshots_no_client_delete
  ON public.lab_response_snapshots;

CREATE POLICY lab_response_snapshots_no_client_select
  ON public.lab_response_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (FALSE);

CREATE POLICY lab_response_snapshots_no_client_insert
  ON public.lab_response_snapshots
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (FALSE);

CREATE POLICY lab_response_snapshots_no_client_update
  ON public.lab_response_snapshots
  FOR UPDATE
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE POLICY lab_response_snapshots_no_client_delete
  ON public.lab_response_snapshots
  FOR DELETE
  TO anon, authenticated
  USING (FALSE);

REVOKE ALL ON TABLE public.lab_response_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_response_snapshots TO service_role;

COMMIT;
