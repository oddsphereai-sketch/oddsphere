-- V73: atomic cross-attempt response-reference ownership. No row DML,
-- funding/claim/lease changes or historical receipt/forecast rewrites.
BEGIN;
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.player_props_ai_receipt(uuid,uuid,bigint,text,jsonb)'::regprocedure)
    NOT IN ('21851c4adc47882ef6269ac6ea41d4a0','fb6ca5bde0f5b22b623fe7ac993db929') THEN RAISE EXCEPTION 'unexpected_receipt_body_before_v73'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.player_props_ai_receipt(p_id uuid,p_token uuid,p_actual bigint,p_response text,p_usage jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a player_props_ai_attempts; j player_props_ai_reviews; response_ref text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO a FROM player_props_ai_attempts WHERE id=p_id FOR UPDATE;
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=a.job_key FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_token OR a.state NOT IN ('sending','completed','unknown') THEN RAISE EXCEPTION 'invalid_receipt_claim'; END IF;
  IF a.state='completed' THEN
    IF a.actual_micro IS DISTINCT FROM p_actual OR a.response_id IS DISTINCT FROM p_response OR a.usage IS DISTINCT FROM p_usage THEN RAISE EXCEPTION 'immutable_usage_receipt_conflict'; END IF; RETURN;
  END IF;
  IF a.response_id IS NOT NULL AND p_response IS NOT NULL AND a.response_id<>p_response THEN RAISE EXCEPTION 'response_identity_conflict'; END IF;
  -- Exact response references belong to one attempt across every game, phase,
  -- sport and restart. The existing global wallet transaction lock serializes
  -- this check with every receipt write, including unknown outcomes. A prior
  -- unknown reference is not evidence that another request owns its response.
  response_ref:=coalesce(p_response,a.response_id);
  IF p_actual IS NOT NULL AND response_ref IS NOT NULL AND response_ref<>'' AND EXISTS(
    SELECT 1 FROM public.player_props_ai_attempts WHERE id<>p_id AND response_id COLLATE "C"=response_ref COLLATE "C"
  ) THEN RAISE EXCEPTION 'response_reference_reused'; END IF;
  IF p_actual<0 THEN RAISE EXCEPTION 'negative_usage'; END IF;
  IF j.state='running' AND p_actual>a.reserved_micro THEN
    -- Record/freeze immediately, before the worker can authorize a fallback.
    PERFORM player_props_ai_release(j.job_key,a.reserved_micro-p_actual);
    UPDATE player_props_ai_reviews SET reserved_micro=reserved_micro+(p_actual-a.reserved_micro) WHERE job_key=j.job_key;
  END IF;
  IF j.state<>'running' AND p_actual IS NOT NULL THEN PERFORM player_props_ai_release(j.job_key,a.reserved_micro-p_actual); END IF;
  UPDATE player_props_ai_attempts SET actual_micro=p_actual,response_id=coalesce(p_response,response_id),usage=coalesce(p_usage,usage),state=CASE WHEN p_actual IS NULL THEN 'unknown' ELSE 'completed' END,completed_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_receipt(uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_receipt(uuid,uuid,bigint,text,jsonb) TO service_role;
COMMIT;
