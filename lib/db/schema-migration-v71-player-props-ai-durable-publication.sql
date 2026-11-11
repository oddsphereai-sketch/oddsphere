-- Existing NBA canonical store only: leased, compare-and-swap publication with
-- server temporal admission. No reviews, model calls, reconstruction or new job.
BEGIN;
CREATE OR REPLACE FUNCTION public.publish_nba_player_props_private_snapshot_v1(
  p_writer_run text,
  p_expected_checksum text,
  p_record jsonb,
  p_admit_before timestamptz DEFAULT NULL,
  p_source_cutoff timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_key text := p_record->>'snapshot_key';
  v_checksum text;
  v_exists boolean;
  v_admitted timestamptz;
  v_completed timestamptz;
BEGIN
  IF coalesce(p_writer_run,'')='' OR jsonb_typeof(p_record) IS DISTINCT FROM 'object'
    OR p_record->>'sport' IS DISTINCT FROM 'nba' OR p_record->>'kind' IS DISTINCT FROM 'daily_edge'
    OR v_key IS DISTINCT FROM 'nba::player-props-private-candidate::'||(p_record->>'slate_date')
    OR coalesce(p_record->>'slate_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR coalesce(p_record->>'source','') NOT LIKE 'nba_player_props_private_writer_%'
    OR p_record->'payload'->>'payloadKind' IS DISTINCT FROM 'candidate_snapshot'
    OR p_record->'payload'->>'encoding' IS DISTINCT FROM 'gzip-base64'
    OR coalesce(p_record->'payload'->>'checksum','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_record->'payload') IS DISTINCT FROM 'object'
    OR coalesce(p_record->>'payload_version','')=''
    OR coalesce(p_record->>'generated_at','')='' OR coalesce(p_record->>'updated_at','')=''
    OR coalesce(p_record->>'expires_at','')='' OR coalesce(p_record->>'stale_until','')=''
    OR (p_admit_before IS NULL) IS DISTINCT FROM (p_source_cutoff IS NULL)
  THEN RETURN jsonb_build_object('written',false,'status','invalid_contract'); END IF;
  -- Retain the same lease row until this transaction finishes. Never acquire a
  -- separate writer or extend the existing sport lease to hide a slow cycle.
  PERFORM 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:nba'
    AND run_id=p_writer_run AND lease_expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('written',false,'status','lease_unavailable'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key,71));
  SELECT payload->>'checksum' INTO v_checksum FROM public.lab_response_snapshots
    WHERE snapshot_key=v_key FOR UPDATE;
  v_exists:=FOUND;
  IF (v_exists AND v_checksum IS NULL) OR v_checksum IS DISTINCT FROM p_expected_checksum
  THEN RETURN jsonb_build_object('written',false,'status','superseded'); END IF;
  v_admitted:=clock_timestamp();
  IF p_admit_before IS NOT NULL AND (v_admitted>=p_admit_before OR p_source_cutoff>v_admitted
    OR p_source_cutoff>=p_admit_before OR (p_record->>'generated_at')::timestamptz<p_source_cutoff
    OR (p_record->>'generated_at')::timestamptz>v_admitted)
  THEN RETURN jsonb_build_object('written',false,'status','publication_window_closed'); END IF;
  BEGIN
    INSERT INTO public.lab_response_snapshots(snapshot_key,kind,sport,slate_date,payload,payload_version,source,generated_at,expires_at,stale_until,updated_at)
    VALUES(v_key,'daily_edge','nba',(p_record->>'slate_date')::date,p_record->'payload',p_record->>'payload_version',p_record->>'source',
      (p_record->>'generated_at')::timestamptz,(p_record->>'expires_at')::timestamptz,(p_record->>'stale_until')::timestamptz,(p_record->>'updated_at')::timestamptz)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,payload_version=excluded.payload_version,source=excluded.source,
      generated_at=excluded.generated_at,expires_at=excluded.expires_at,stale_until=excluded.stale_until,updated_at=excluded.updated_at;
    v_completed:=clock_timestamp();
    -- Raising within the subtransaction rolls the upsert back. This clock is
    -- server write completion, not a claim of the eventual transaction commit.
    IF p_admit_before IS NOT NULL AND v_completed>=p_admit_before
    THEN RAISE EXCEPTION USING ERRCODE='P7101',MESSAGE='publication_window_closed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:nba'
      AND run_id=p_writer_run AND lease_expires_at>v_completed)
    THEN RAISE EXCEPTION USING ERRCODE='P7102',MESSAGE='lease_unavailable'; END IF;
  EXCEPTION WHEN SQLSTATE 'P7101' THEN RETURN jsonb_build_object('written',false,'status','publication_window_closed');
    WHEN SQLSTATE 'P7102' THEN RETURN jsonb_build_object('written',false,'status','lease_unavailable');
  END;
  RETURN jsonb_build_object('written',true,'status','written','server_admitted_at',v_admitted,
    'server_write_completed_at',v_completed,'checksum',p_record->'payload'->>'checksum');
END;
$$;
REVOKE ALL ON FUNCTION public.publish_nba_player_props_private_snapshot_v1(text,text,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_nba_player_props_private_snapshot_v1(text,text,jsonb,timestamptz,timestamptz) TO service_role;
COMMIT;
