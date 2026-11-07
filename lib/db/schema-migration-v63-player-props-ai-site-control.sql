-- Inactive installation. No prediction/lock is modified and no HTTP request is made.
BEGIN;
CREATE TABLE IF NOT EXISTS public.player_props_ai_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  release text NOT NULL DEFAULT 'player_props_ai_control_2026_11_07_r1_explicit_off',
  paid_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.player_props_ai_control(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.player_props_ai_calendars (
  month_key text PRIMARY KEY CHECK(month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  release text NOT NULL,
  captured_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE public.player_props_ai_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_props_ai_calendars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_props_ai_control,public.player_props_ai_calendars FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.player_props_ai_control,public.player_props_ai_calendars TO service_role;
-- Defense in depth: even an incorrectly enabled environment cannot claim or send.
CREATE OR REPLACE FUNCTION public.player_props_ai_paid_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF ((TG_TABLE_NAME='player_props_ai_reviews' AND NEW.state='running' AND OLD.state IS DISTINCT FROM 'running')
    OR (TG_TABLE_NAME='player_props_ai_attempts' AND NEW.state='sending' AND OLD.state IS DISTINCT FROM 'sending'))
    AND NOT EXISTS(SELECT 1 FROM public.player_props_ai_control WHERE singleton AND paid_enabled AND release='player_props_ai_control_2026_11_07_r1_explicit_off') THEN
    RAISE EXCEPTION 'player_props_ai_paid_runs_disabled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS player_props_ai_review_paid_guard ON public.player_props_ai_reviews;
CREATE TRIGGER player_props_ai_review_paid_guard BEFORE UPDATE ON public.player_props_ai_reviews FOR EACH ROW EXECUTE FUNCTION public.player_props_ai_paid_guard();
DROP TRIGGER IF EXISTS player_props_ai_attempt_paid_guard ON public.player_props_ai_attempts;
CREATE TRIGGER player_props_ai_attempt_paid_guard BEFORE UPDATE ON public.player_props_ai_attempts FOR EACH ROW EXECUTE FUNCTION public.player_props_ai_paid_guard();
REVOKE ALL ON FUNCTION public.player_props_ai_paid_guard() FROM PUBLIC,anon,authenticated;

-- Full-calendar reconciliation: retain cancelled obligations as audit rows, never delete a review.
-- A failed replacement rolls back all retirements and freezes new authorizations for that month.
CREATE OR REPLACE FUNCTION public.player_props_ai_plan_v3(p_month text,p_jobs jsonb,p_companions jsonb,p_plan_hash text,p_sources jsonb,p_release text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r player_props_ai_reviews; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  BEGIN
    UPDATE player_props_ai_reviews r0 SET state='pending',error_code=NULL
      WHERE r0.state='cancelled' AND r0.error_code='complete_calendar_rescheduled_or_cancelled'
      AND NOT EXISTS(SELECT 1 FROM player_props_ai_attempts a WHERE a.job_key=r0.job_key)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) j WHERE j->>'key'=r0.job_key);
    FOR r IN SELECT * FROM player_props_ai_reviews WHERE billing_month=p_month AND state='pending'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) j WHERE j->>'key'=job_key) FOR UPDATE LOOP
      UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-r.reserved_micro WHERE month_key=p_month;
      UPDATE player_props_ai_reviews SET state='cancelled',reserved_micro=0,error_code='complete_calendar_rescheduled_or_cancelled',updated_at=clock_timestamp() WHERE job_key=r.job_key;
    END LOOP;
    result:=player_props_ai_plan_v2(p_month,p_jobs,p_companions,p_plan_hash,p_sources,p_release);
    IF (result->>'funded')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'replacement_plan_not_funded'; END IF;
  EXCEPTION WHEN OTHERS THEN
    UPDATE player_props_ai_budgets SET full_calendar=false,funding_error='complete_calendar_reconciliation_failed',updated_at=clock_timestamp() WHERE month_key=p_month;
    RETURN jsonb_build_object('funded',false,'reason','complete_calendar_reconciliation_failed');
  END;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text) TO service_role;
COMMIT;
