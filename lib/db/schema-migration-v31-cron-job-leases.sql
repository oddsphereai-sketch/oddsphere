-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V31 — Cron job leases
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Provide an atomic database-backed lease for production cron routes. This
--   prevents two copies of the same job from running concurrently even when
--   multiple Vercel invocations arrive close together.

BEGIN;

CREATE TABLE IF NOT EXISTS cron_job_leases (
  job_name TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION try_acquire_cron_job_lease(
  p_job_name TEXT,
  p_run_id TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE(acquired BOOLEAN, existing_run_id TEXT, lease_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ := NOW() + make_interval(secs => GREATEST(p_lease_seconds, 30));
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO cron_job_leases AS l (
    job_name,
    run_id,
    acquired_at,
    heartbeat_at,
    lease_expires_at
  )
  VALUES (
    p_job_name,
    p_run_id,
    v_now,
    v_now,
    v_expires
  )
  ON CONFLICT (job_name) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        acquired_at = EXCLUDED.acquired_at,
        heartbeat_at = EXCLUDED.heartbeat_at,
        lease_expires_at = EXCLUDED.lease_expires_at
    WHERE l.lease_expires_at <= v_now;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    acquired := true;
    existing_run_id := p_run_id;
    lease_expires_at := v_expires;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT false, l.run_id, l.lease_expires_at
  INTO acquired, existing_run_id, lease_expires_at
  FROM cron_job_leases l
  WHERE l.job_name = p_job_name;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION release_cron_job_lease(
  p_job_name TEXT,
  p_run_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM cron_job_leases
  WHERE job_name = p_job_name
    AND run_id = p_run_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMIT;
