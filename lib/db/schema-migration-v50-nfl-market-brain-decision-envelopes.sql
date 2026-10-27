-- Freeze the evaluation-only quote/action context at capture time and prove
-- every newly persisted research input copied it from the latest successful
-- pre-cutoff member of its exact finalized capture set. Existing rows remain
-- immutable and are not rewritten or reinterpreted by this migration.

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_shadow_decision_envelopes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.shadow ? 'case' AND
     (jsonb_typeof(NEW.shadow #> '{case,decisionEnvelopes}') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'NFL Market Brain successful shadow capture must freeze its decision envelopes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_shadow_decision_envelopes
  ON public.nfl_market_brain_shadow_snapshots;
CREATE TRIGGER nfl_market_brain_shadow_decision_envelopes
BEFORE INSERT ON public.nfl_market_brain_shadow_snapshots
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_shadow_decision_envelopes();

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_research_decision_envelopes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  captured_decision_envelopes jsonb;
BEGIN
  IF jsonb_typeof(NEW.research_input -> 'decisionEnvelopes') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'NFL Market Brain research input must contain frozen decision envelopes';
  END IF;

  SELECT shadow.shadow #> '{case,decisionEnvelopes}'
    INTO captured_decision_envelopes
    FROM public.nfl_market_brain_capture_sets capture_set
    CROSS JOIN LATERAL jsonb_array_elements(capture_set.capture_set -> 'membership') membership
    JOIN public.nfl_market_brain_shadow_snapshots shadow
      ON shadow.id = (membership ->> 'recordId')::uuid
     AND shadow.provider_game_id = capture_set.event_id
     AND shadow.shadow_release = capture_set.shadow_release
     AND shadow.contract_release = capture_set.contract_release
     AND shadow.capture_attempt_id = (membership ->> 'runId')::uuid
     AND shadow.stage = membership ->> 'stage'
     AND shadow.shadow_sha256 = membership ->> 'shadowSha256'
     AND shadow.captured_at = (membership ->> 'capturedAt')::timestamptz
     AND shadow.created_at = (membership ->> 'serverCreatedAt')::timestamptz
   WHERE capture_set.id = NEW.capture_set_id
     AND capture_set.capture_set_checksum = NEW.capture_set_checksum
     AND capture_set.event_id = NEW.event_id
     AND capture_set.cutoff_at = NEW.cutoff_at
     AND capture_set.starts_at = NEW.starts_at
     AND membership ->> 'status' = 'captured'
     AND shadow.shadow ? 'case'
     AND (shadow.shadow #>> '{case,evaluatedAt}')::timestamptz <= NEW.cutoff_at
   ORDER BY (shadow.shadow #>> '{case,evaluatedAt}')::timestamptz DESC,
            shadow.captured_at DESC,
            shadow.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NFL Market Brain research input has no successful pre-cutoff capture-set case';
  END IF;
  IF captured_decision_envelopes IS DISTINCT FROM NEW.research_input -> 'decisionEnvelopes' THEN
    RAISE EXCEPTION 'NFL Market Brain research input decision envelopes differ from the latest captured case';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_research_decision_envelopes
  ON public.nfl_market_brain_research_inputs;
CREATE TRIGGER nfl_market_brain_research_decision_envelopes
BEFORE INSERT ON public.nfl_market_brain_research_inputs
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_research_decision_envelopes();

REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_shadow_decision_envelopes()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_research_decision_envelopes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_shadow_decision_envelopes()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_research_decision_envelopes()
  TO service_role;

COMMENT ON FUNCTION public.enforce_nfl_market_brain_research_decision_envelopes() IS
  'Rejects every new NFL Market Brain inference input whose evaluation-only quote/action envelope is absent or differs from the latest successful pre-cutoff case in its exact finalized capture set.';
