-- Private pre-claim NFL identity evidence only. No funded/prediction/result writes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.player_props_ai_nfl_source_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('captured','archive_unavailable','overflow')),
  semantic_sha256 text CHECK(semantic_sha256 ~ '^[a-f0-9]{64}$'),
  writer_run_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capture jsonb NOT NULL CHECK(octet_length(capture::text)<=650000),
  CHECK((kind='overflow')=(semantic_sha256 IS NULL)),
  UNIQUE(job_key,semantic_sha256)
);
CREATE UNIQUE INDEX IF NOT EXISTS player_props_ai_nfl_source_failures_one_overflow
  ON public.player_props_ai_nfl_source_failures(job_key) WHERE kind='overflow';
ALTER TABLE public.player_props_ai_nfl_source_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_props_ai_nfl_source_failures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_props_ai_nfl_source_failures FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.player_props_ai_nfl_source_failures TO service_role;
DROP POLICY IF EXISTS source_failures_service_read ON public.player_props_ai_nfl_source_failures;
DROP POLICY IF EXISTS source_failures_owner_read ON public.player_props_ai_nfl_source_failures;
DROP POLICY IF EXISTS source_failures_owner_append ON public.player_props_ai_nfl_source_failures;
CREATE POLICY source_failures_service_read ON public.player_props_ai_nfl_source_failures FOR SELECT TO service_role USING(true);
-- The function owner needs read/append under FORCE RLS even when it is not a
-- superuser/BYPASSRLS role. Clients have no direct append privilege/policy.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY source_failures_owner_read ON public.player_props_ai_nfl_source_failures FOR SELECT TO %I USING(true)',current_user);
  EXECUTE format('CREATE POLICY source_failures_owner_append ON public.player_props_ai_nfl_source_failures FOR INSERT TO %I WITH CHECK(true)',current_user);
END $$;
CREATE OR REPLACE FUNCTION public.player_props_ai_source_failure_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'private_source_failure_evidence_is_append_only'; END $$;
DROP TRIGGER IF EXISTS player_props_ai_source_failure_immutable ON public.player_props_ai_nfl_source_failures;
DROP TRIGGER IF EXISTS player_props_ai_source_failure_no_truncate ON public.player_props_ai_nfl_source_failures;
CREATE TRIGGER player_props_ai_source_failure_immutable
BEFORE UPDATE OR DELETE ON public.player_props_ai_nfl_source_failures
FOR EACH ROW EXECUTE FUNCTION public.player_props_ai_source_failure_immutable();
CREATE TRIGGER player_props_ai_source_failure_no_truncate
BEFORE TRUNCATE ON public.player_props_ai_nfl_source_failures
FOR EACH STATEMENT EXECUTE FUNCTION public.player_props_ai_source_failure_immutable();
REVOKE ALL ON FUNCTION public.player_props_ai_source_failure_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_append_source_failure_v1(p_writer_run text,p_capture jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.player_props_ai_reviews; row_id uuid; seen integer; observed timestamptz; captured timestamptz;
  canonical text; semantic jsonb; signature text; data bytea; count_entry record; hash_entry record; now_at timestamptz:=clock_timestamp();
BEGIN
  -- No privilege on this RPC is granted to PUBLIC/anon/authenticated.
  IF btrim(coalesce(p_writer_run,''))='' OR octet_length(p_writer_run)>256 OR jsonb_typeof(p_capture) IS DISTINCT FROM 'object' OR octet_length(p_capture::text)>600000 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_capture->>'writerRunId' IS DISTINCT FROM p_writer_run OR p_capture->>'release' IS DISTINCT FROM 'player_props_ai_nfl_source_failure_2026_11_10_r1_private_exact_input'
    OR p_capture->>'identityRelease' IS DISTINCT FROM 'player_props_ai_nfl_identity_2026_11_10_r1_cutoff_exact_id'
    OR p_capture->>'eventSourceRelease' IS DISTINCT FROM 'player_props_ai_nfl_source_2026_11_09_r3_event_qualification' OR p_capture->>'purpose' IS DISTINCT FROM 'scheduled_review'
    OR coalesce(p_capture->>'stage','') NOT IN ('early','final') OR coalesce(p_capture->>'status','') NOT IN ('captured','archive_unavailable')
    OR p_capture->>'observedAtMeaning' IS DISTINCT FROM 'requested_source_cutoff' OR jsonb_typeof(p_capture->'captureAfterLock') IS DISTINCT FROM 'boolean'
    OR coalesce(p_capture->>'failureCode','') NOT IN ('nfl_offered_player_identity_incomplete','nfl_provider_identity_conflict','nfl_player_name_conflict','nfl_player_team_conflict','nfl_roster_game_identity_conflict','nfl_roster_team_identity_conflict','nfl_captured_player_ambiguous')
    OR coalesce(p_capture->>'writerRelease','')='' OR coalesce(p_capture->>'generationRelease','')='' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_capture) AS k(key) WHERE key NOT IN ('release','identityRelease','eventSourceRelease','purpose','writerRelease','writerRunId','generationRelease','failureCode','jobKey','fundedGameId','nativeGameId','stage','start','lock','observedAt','observedAtMeaning','capturedAt','captureAfterLock','status','semanticCanonical','semanticSha256','counts','sourceHashes','archive','archiveUnavailable')) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF to_regclass('public.cron_job_leases') IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  PERFORM 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:nfl' AND run_id=p_writer_run AND lease_expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO j FROM public.player_props_ai_reviews WHERE job_key=p_capture->>'jobKey' FOR SHARE;
  IF NOT FOUND OR j.sport<>'nfl' OR j.game_id IS DISTINCT FROM p_capture->>'fundedGameId' OR j.stage IS DISTINCT FROM p_capture->>'stage'
    OR j.scheduled_start IS DISTINCT FROM (p_capture->>'start')::timestamptz OR j.lock_at IS DISTINCT FROM (p_capture->>'lock')::timestamptz
    OR coalesce(p_capture->>'nativeGameId','')='' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  observed:=(p_capture->>'observedAt')::timestamptz;captured:=(p_capture->>'capturedAt')::timestamptz;
  IF (p_capture->>'captureAfterLock')::boolean IS DISTINCT FROM (captured>=j.lock_at) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF observed IS NULL OR captured IS NULL OR observed<j.due_at OR observed>=j.lock_at OR observed>captured OR captured>now_at
    OR captured>j.lock_at+interval '10 minutes' OR now_at>j.lock_at+interval '10 minutes'
    OR NOT(j.state='pending' AND now_at<j.lock_at OR j.state IN ('pending','failed','expired','completed','cancelled') AND now_at>=j.lock_at)
    THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  canonical:=p_capture->>'semanticCanonical';signature:=p_capture->>'semanticSha256';
  IF canonical IS NULL OR octet_length(canonical)>128000 OR signature IS NULL OR signature!~'^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(canonical,'UTF8')),'hex')<>signature THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  semantic:=canonical::jsonb;
  IF jsonb_typeof(semantic) IS DISTINCT FROM 'object' OR jsonb_typeof(semantic->'state') IS DISTINCT FROM 'object'
    OR semantic->>'release' IS DISTINCT FROM p_capture->>'release' OR semantic->>'identityRelease' IS DISTINCT FROM p_capture->>'identityRelease'
    OR semantic->>'eventSourceRelease' IS DISTINCT FROM p_capture->>'eventSourceRelease' OR semantic->>'purpose' IS DISTINCT FROM 'scheduled_review'
    OR semantic->>'failureCode' IS DISTINCT FROM p_capture->>'failureCode'
    OR semantic->>'writerRelease' IS DISTINCT FROM p_capture->>'writerRelease' OR semantic->>'generationRelease' IS DISTINCT FROM p_capture->>'generationRelease'
    OR semantic->>'jobKey' IS DISTINCT FROM j.job_key OR semantic->>'fundedGameId' IS DISTINCT FROM j.game_id
    OR semantic->>'nativeGameId' IS DISTINCT FROM p_capture->>'nativeGameId' OR semantic->>'stage' IS DISTINCT FROM j.stage
    OR semantic->>'start' IS DISTINCT FROM p_capture->>'start' OR semantic->>'lock' IS DISTINCT FROM p_capture->>'lock'
    THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF jsonb_typeof(p_capture->'counts') IS DISTINCT FROM 'object' OR NOT(p_capture->'counts' ?& ARRAY['sourceRows','relevantRows','candidateRows','failedRows','nativeRows','memberRows','contexts']) OR jsonb_typeof(p_capture->'sourceHashes') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  FOR count_entry IN SELECT * FROM jsonb_each(p_capture->'counts') LOOP
    IF count_entry.key NOT IN ('sourceRows','relevantRows','candidateRows','failedRows','nativeRows','memberRows','contexts') OR jsonb_typeof(count_entry.value)<>'number'
      OR count_entry.value::text!~'^\d+$' OR (count_entry.value::text)::numeric>1000000 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END LOOP;
  IF NOT(p_capture->'sourceHashes' ?& ARRAY['observations','nativeSnapshot','context']) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  FOR hash_entry IN SELECT * FROM jsonb_each(p_capture->'sourceHashes') LOOP
    IF hash_entry.key NOT IN ('observations','nativeSnapshot','context','identityInput') OR (hash_entry.value IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(hash_entry.value) IS DISTINCT FROM 'string' OR (hash_entry.value#>>'{}')!~'^[a-f0-9]{64}$')) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END LOOP;
  IF (p_capture->'counts'->>'failedRows')::integer>(p_capture->'counts'->>'candidateRows')::integer
    OR (p_capture->'counts'->>'candidateRows')::integer>(p_capture->'counts'->>'relevantRows')::integer
    OR (p_capture->'counts'->>'relevantRows')::integer>(p_capture->'counts'->>'sourceRows')::integer THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_capture->>'status'='captured' THEN
    IF jsonb_typeof(p_capture->'archive') IS DISTINCT FROM 'object' OR p_capture->'archive'->>'encoding' IS DISTINCT FROM 'gzip-base64'
      OR coalesce(p_capture->'archive'->>'bytes','')!~'^\d+$' OR (p_capture->'archive'->>'bytes')::integer NOT BETWEEN 1 AND 8000000
      OR coalesce(p_capture->'archive'->>'gzipBytes','')!~'^\d+$' OR (p_capture->'archive'->>'gzipBytes')::integer NOT BETWEEN 1 AND 262144
      OR coalesce(p_capture->'archive'->>'sha256','')!~'^[a-f0-9]{64}$' OR coalesce(p_capture->'archive'->>'gzipSha256','')!~'^[a-f0-9]{64}$'
      OR p_capture->'archiveUnavailable' IS DISTINCT FROM 'null'::jsonb
      OR length(p_capture->'archive'->>'data')>349528 OR coalesce(p_capture->'archive'->>'data','')!~'^[A-Za-z0-9+/]*={0,2}$'
      THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    data:=decode(p_capture->'archive'->>'data','base64');
    IF octet_length(data)<>(p_capture->'archive'->>'gzipBytes')::integer OR encode(sha256(data),'hex')<>p_capture->'archive'->>'gzipSha256'
      OR p_capture->'sourceHashes'->>'identityInput' IS DISTINCT FROM p_capture->'archive'->>'sha256' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- PostgreSQL verifies compressed bytes. Raw hash/schema are verified by the
    -- pure decoder before append and on audit; neither is independent attestation.
  ELSE
    IF p_capture->'archive' IS DISTINCT FROM 'null'::jsonb OR p_capture->>'archiveUnavailable' NOT IN ('semantic_bound','raw_input_bound','gzip_input_bound','record_bound','capture_construction_failed') THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('props_nfl_source_failure:'||j.job_key,0)) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT id INTO row_id FROM public.player_props_ai_nfl_source_failures WHERE job_key=j.job_key AND semantic_sha256=signature;
  IF FOUND THEN RETURN jsonb_build_object('status','duplicate','id',row_id); END IF;
  SELECT count(*) INTO seen FROM public.player_props_ai_nfl_source_failures WHERE job_key=j.job_key AND kind<>'overflow';
  IF seen>=4 THEN
    SELECT id INTO row_id FROM public.player_props_ai_nfl_source_failures WHERE job_key=j.job_key AND kind='overflow';
    IF FOUND THEN RETURN jsonb_build_object('status','overflow_already_recorded','id',row_id); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:nfl' AND run_id=p_writer_run AND lease_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    INSERT INTO public.player_props_ai_nfl_source_failures(job_key,kind,semantic_sha256,writer_run_id,observed_at,capture)
      VALUES(j.job_key,'overflow',NULL,p_writer_run,observed,jsonb_build_object('release',p_capture->>'release','identityRelease',p_capture->>'identityRelease',
        'firstOmittedSemanticSha256',signature,'counts',p_capture->'counts','sourceHashes',p_capture->'sourceHashes','meaning','Further distinct states are not archived or counted by this one immutable marker.')) RETURNING id INTO row_id;
    RETURN jsonb_build_object('status','overflow','id',row_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:nfl' AND run_id=p_writer_run AND lease_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  INSERT INTO public.player_props_ai_nfl_source_failures(job_key,kind,semantic_sha256,writer_run_id,observed_at,capture)
    VALUES(j.job_key,p_capture->>'status',signature,p_writer_run,observed,p_capture) RETURNING id INTO row_id;
  RETURN jsonb_build_object('status','stored','id',row_id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('status','unavailable');
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_append_source_failure_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.player_props_ai_append_source_failure_v1(text,jsonb) TO service_role;
COMMENT ON TABLE public.player_props_ai_nfl_source_failures IS 'Service-only append-only normalized identity diagnostics; never model reviews, public picks, independent clock attestations or paid attempts.';
COMMIT;
