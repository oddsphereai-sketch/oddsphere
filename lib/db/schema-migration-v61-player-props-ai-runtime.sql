-- Full-product primary AI forecasts, not a shadow writer. Amounts are integer microdollars.
BEGIN;
CREATE TABLE IF NOT EXISTS public.player_props_ai_budgets (
  month_key text PRIMARY KEY CHECK (month_key ~ '^\d{4}-\d{2}$'),
  cap_micro bigint NOT NULL DEFAULT 30000000 CHECK (cap_micro BETWEEN 0 AND 50000000),
  core_reserved_micro bigint NOT NULL DEFAULT 0 CHECK (core_reserved_micro >= 0),
  consumed_micro bigint NOT NULL DEFAULT 0 CHECK (consumed_micro >= 0),
  recovery_remaining_micro bigint NOT NULL DEFAULT 3000000 CHECK (recovery_remaining_micro >= 0),
  planned_games integer NOT NULL DEFAULT 0 CHECK (planned_games >= 0),
  stronger_finals integer NOT NULL DEFAULT 0 CHECK (stronger_finals >= 0),
  full_calendar boolean NOT NULL DEFAULT false,
  plan_hash text,
  calendar_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (core_reserved_micro + consumed_micro + recovery_remaining_micro <= cap_micro)
);
CREATE TABLE IF NOT EXISTS public.player_props_ai_reviews (
  job_key text PRIMARY KEY,
  sport text NOT NULL CHECK (sport IN ('nba','nfl','mlb')),
  game_id text NOT NULL,
  game_day date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('early','final')),
  scheduled_start timestamptz NOT NULL,
  lock_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  billing_month text NOT NULL REFERENCES public.player_props_ai_budgets(month_key),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed','expired','cancelled')),
  reserved_micro bigint NOT NULL DEFAULT 40000 CHECK (reserved_micro >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  model text CHECK (model IN ('gpt-6-luna','gpt-6.1-terra')),
  parts integer CHECK (parts BETWEEN 1 AND 4),
  phase integer NOT NULL DEFAULT 0 CHECK (phase BETWEEN 0 AND 2),
  input_hash text,
  recovery_draw_micro bigint NOT NULL DEFAULT 0 CHECK(recovery_draw_micro>=0),
  result jsonb,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport,game_id,game_day,stage),
  CHECK (due_at < lock_at AND lock_at <= scheduled_start),
  CHECK (state = 'completed' OR result IS NULL)
);
CREATE INDEX IF NOT EXISTS player_props_ai_reviews_due ON public.player_props_ai_reviews(sport,state,due_at,lock_at);
CREATE TABLE IF NOT EXISTS public.player_props_ai_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL REFERENCES public.player_props_ai_reviews(job_key),
  phase integer NOT NULL CHECK (phase IN (1,2)),
  part integer NOT NULL CHECK (part BETWEEN 1 AND 4),
  model text NOT NULL CHECK (model IN ('gpt-6-luna','gpt-6.1-terra')),
  reserved_micro bigint NOT NULL CHECK (reserved_micro > 0 AND reserved_micro <= 200000),
  actual_micro bigint CHECK (actual_micro >= 0 AND actual_micro <= reserved_micro),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','sending','completed','unknown')),
  response_id text,
  usage jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(job_key,phase,part)
);

-- A single short transaction mutex serializes all wallet mutations across sports/months.
-- Model HTTP calls never run inside a transaction. Sport prediction leases remain separate.
CREATE OR REPLACE FUNCTION public.player_props_ai_plan(p_month text,p_jobs jsonb,p_plan_hash text,p_sources jsonb,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b player_props_ai_budgets; j jsonb; prior player_props_ai_reviews; added bigint:=0; game_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_complete IS NOT TRUE OR jsonb_typeof(p_jobs)<>'array' OR p_plan_hash IS NULL OR jsonb_array_length(p_jobs)>2000 THEN RAISE EXCEPTION 'full_calendar_required'; END IF;
  INSERT INTO player_props_ai_budgets(month_key) VALUES(p_month) ON CONFLICT DO NOTHING;
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=p_month FOR UPDATE;
  FOR j IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    IF to_char((j->>'dueAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM')<>p_month
      AND NOT ((j->>'dueAt')::timestamptz<clock_timestamp() AND (j->>'lock')::timestamptz>clock_timestamp() AND to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')=p_month)
    THEN RAISE EXCEPTION 'wrong_billing_month'; END IF;
    SELECT * INTO prior FROM player_props_ai_reviews WHERE job_key=j->>'key' FOR UPDATE;
    IF FOUND THEN
      IF prior.state<>'pending' THEN CONTINUE; END IF;
      IF prior.billing_month<>p_month THEN
        UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-prior.reserved_micro,updated_at=clock_timestamp() WHERE month_key=prior.billing_month;
        added:=added+prior.reserved_micro;
      END IF;
      UPDATE player_props_ai_reviews SET due_at=(j->>'dueAt')::timestamptz,lock_at=(j->>'lock')::timestamptz,scheduled_start=(j->>'start')::timestamptz,billing_month=p_month,updated_at=clock_timestamp() WHERE job_key=prior.job_key;
    ELSE
      INSERT INTO player_props_ai_reviews(job_key,sport,game_id,game_day,stage,scheduled_start,lock_at,due_at,billing_month,reserved_micro)
      VALUES(j->>'key',j->>'sport',j->>'gameId',(j->>'gameDay')::date,j->>'stage',(j->>'start')::timestamptz,(j->>'lock')::timestamptz,(j->>'dueAt')::timestamptz,p_month,CASE j->>'sport' WHEN 'nba' THEN 32000 WHEN 'nfl' THEN 24000 ELSE 38000 END);
      added:=added+CASE j->>'sport' WHEN 'nba' THEN 32000 WHEN 'nfl' THEN 24000 ELSE 38000 END;
    END IF;
  END LOOP;
  SELECT count(DISTINCT sport||'|'||game_id||'|'||game_day::text) INTO game_count FROM player_props_ai_reviews WHERE billing_month=p_month AND state<>'cancelled';
  IF b.core_reserved_micro+added+b.consumed_micro+b.recovery_remaining_micro>b.cap_micro THEN RAISE EXCEPTION 'complete_primary_plan_exceeds_monthly_cap'; END IF;
  UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro+added,full_calendar=true,plan_hash=p_plan_hash,calendar_sources=p_sources,planned_games=game_count,updated_at=clock_timestamp() WHERE month_key=p_month RETURNING * INTO b;
  RETURN to_jsonb(b);
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_claim(p_key text,p_hash text,p_requests jsonb,p_prefer_stronger boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; b player_props_ai_budgets; chosen text:='gpt-6-luna'; charge bigint:=0; strong_charge bigint:=0; token uuid:=gen_random_uuid(); n integer; r jsonb; part_cost bigint; strong_ok boolean:=true; draw bigint:=0; free bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'pending' THEN RETURN jsonb_build_object('claimed',false,'reason','not_pending'); END IF;
  IF clock_timestamp()<j.due_at THEN RETURN jsonb_build_object('claimed',false,'reason','not_due'); END IF;
  IF clock_timestamp()>=j.lock_at THEN
    UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro WHERE month_key=j.billing_month;
    UPDATE player_props_ai_reviews SET state='expired',reserved_micro=0,error_code='missed_window',updated_at=clock_timestamp() WHERE job_key=p_key;
    RETURN jsonb_build_object('claimed',false,'reason','after_lock');
  END IF;
  IF (clock_timestamp() AT TIME ZONE 'America/New_York')::date<>j.game_day THEN RETURN jsonb_build_object('claimed',false,'reason','not_game_day'); END IF;
  IF j.billing_month<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') THEN RAISE EXCEPTION 'billing_month_rollover_requires_replan'; END IF;
  IF jsonb_typeof(p_requests)<>'array' OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 4 OR p_hash IS NULL THEN RAISE EXCEPTION 'invalid_funded_partition_count'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_requests) LOOP
    IF (r->>'input_tokens')::integer NOT BETWEEN 1 AND 145000 OR (r->>'max_output_tokens')::integer NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'request_exceeds_counted_bound'; END IF;
    charge:=charge+ceil(((r->>'input_tokens')::numeric+2048)*.1+(r->>'max_output_tokens')::numeric*.5)::bigint;
    IF r->>'strong_input_tokens' IS NULL OR (r->>'strong_input_tokens')::integer NOT BETWEEN 1 AND 145000 THEN strong_ok:=false;
    ELSE strong_charge:=strong_charge+ceil(((r->>'strong_input_tokens')::numeric+2048)+(r->>'max_output_tokens')::numeric*5)::bigint; END IF;
  END LOOP;
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=j.billing_month FOR UPDATE;
  IF b.full_calendar IS NOT TRUE THEN RAISE EXCEPTION 'complete_month_not_funded'; END IF;
  IF (SELECT count(*) FROM player_props_ai_reviews WHERE state='running')>=2 THEN RETURN jsonb_build_object('claimed',false,'reason','global_concurrency_busy'); END IF;
  free:=b.cap_micro-b.consumed_micro-b.core_reserved_micro-b.recovery_remaining_micro;
  IF p_prefer_stronger AND j.stage='final' AND strong_ok AND b.stronger_finals<floor(b.planned_games*.1) AND free>=strong_charge-j.reserved_micro
    THEN chosen:='gpt-6.1-terra';charge:=strong_charge; END IF;
  -- Actual complete-input bounds may exceed a sport's baseline allowance. Core
  -- coverage takes priority over upgrades and can use the recovery reserve.
  draw:=greatest(0,charge-j.reserved_micro-free);
  IF draw>b.recovery_remaining_micro THEN RETURN jsonb_build_object('claimed',false,'reason','primary_packet_funding_gap'); END IF;
  UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro,consumed_micro=consumed_micro+charge,recovery_remaining_micro=recovery_remaining_micro-draw,stronger_finals=stronger_finals+CASE WHEN chosen='gpt-6.1-terra' THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET state='running',claim_token=token,claimed_at=clock_timestamp(),model=chosen,parts=jsonb_array_length(p_requests),phase=1,input_hash=p_hash,reserved_micro=charge,recovery_draw_micro=draw,updated_at=clock_timestamp() WHERE job_key=p_key RETURNING * INTO j;
  FOR n IN 1..j.parts LOOP
    r:=p_requests->(n-1);
    part_cost:=CASE WHEN chosen='gpt-6.1-terra' THEN ceil(((r->>'strong_input_tokens')::numeric+2048)+(r->>'max_output_tokens')::numeric*5)::bigint ELSE ceil(((r->>'input_tokens')::numeric+2048)*.1+(r->>'max_output_tokens')::numeric*.5)::bigint END;
    INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro) VALUES(p_key,1,n,chosen,part_cost);
  END LOOP;
  RETURN jsonb_build_object('claimed',true,'token',token,'job',to_jsonb(j));
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_send(p_key text,p_token uuid,p_phase integer,p_part integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; a player_props_ai_attempts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'running' OR j.claim_token<>p_token OR j.phase<>p_phase OR clock_timestamp()>=j.lock_at THEN RAISE EXCEPTION 'invalid_or_expired_send_claim'; END IF;
  UPDATE player_props_ai_attempts SET state='sending',started_at=clock_timestamp() WHERE job_key=p_key AND phase=p_phase AND part=p_part AND state='reserved' RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_already_claimed'; END IF;
  RETURN to_jsonb(a);
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_receipt(p_id uuid,p_token uuid,p_actual bigint,p_response text,p_usage jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a player_props_ai_attempts; j player_props_ai_reviews; restore bigint:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO a FROM player_props_ai_attempts WHERE id=p_id FOR UPDATE;
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=a.job_key FOR UPDATE;
  IF j.claim_token IS DISTINCT FROM p_token OR a.state NOT IN ('sending','completed','unknown') THEN RAISE EXCEPTION 'invalid_receipt_claim'; END IF;
  IF a.state='completed' THEN
    IF a.actual_micro IS DISTINCT FROM p_actual OR a.response_id IS DISTINCT FROM p_response THEN RAISE EXCEPTION 'immutable_usage_receipt_conflict'; END IF;
    RETURN;
  END IF;
  IF a.response_id IS NOT NULL AND p_response IS NOT NULL AND a.response_id<>p_response THEN RAISE EXCEPTION 'response_identity_conflict'; END IF;
  IF p_actual IS NOT NULL AND (p_actual<0 OR p_actual>a.reserved_micro) THEN RAISE EXCEPTION 'usage_exceeds_reserved_bound'; END IF;
  IF j.state<>'running' AND p_actual IS NOT NULL THEN
    restore:=CASE WHEN a.phase=2 THEN a.reserved_micro-p_actual ELSE least(j.recovery_draw_micro,a.reserved_micro-p_actual) END;
    UPDATE player_props_ai_budgets SET consumed_micro=consumed_micro-(a.reserved_micro-p_actual),recovery_remaining_micro=recovery_remaining_micro+restore,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
    IF a.phase=1 THEN UPDATE player_props_ai_reviews SET recovery_draw_micro=recovery_draw_micro-restore WHERE job_key=j.job_key; END IF;
  END IF;
  UPDATE player_props_ai_attempts SET actual_micro=p_actual,response_id=coalesce(p_response,response_id),usage=coalesce(p_usage,usage),state=CASE WHEN p_actual IS NULL THEN 'unknown' ELSE 'completed' END,completed_at=clock_timestamp() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_repair(p_key text,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; b player_props_ai_budgets; charge bigint; n integer; per_part bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'running' OR j.claim_token IS DISTINCT FROM p_token OR j.phase<>1 OR clock_timestamp()+interval '3 minutes'>=j.lock_at THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1 AND state<>'completed') THEN RETURN false; END IF;
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=j.billing_month FOR UPDATE;
  SELECT sum(reserved_micro) INTO charge FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1;
  IF b.recovery_remaining_micro<charge THEN RETURN false; END IF;
  UPDATE player_props_ai_budgets SET recovery_remaining_micro=recovery_remaining_micro-charge,consumed_micro=consumed_micro+charge,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET phase=2,reserved_micro=reserved_micro+charge,claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE job_key=p_key;
  FOR n IN 1..j.parts LOOP
    SELECT reserved_micro INTO per_part FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1 AND part=n;
    INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro) VALUES(p_key,2,n,j.model,per_part);
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_finish(p_key text,p_token uuid,p_result jsonb,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; charged bigint; repair_refund bigint; primary_refund bigint; completed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF j.claim_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'wrong_finish_claim'; END IF;
  IF j.state<>'running' THEN RETURN to_jsonb(j); END IF;
  SELECT coalesce(sum(CASE WHEN state='reserved' THEN 0 ELSE coalesce(actual_micro,reserved_micro) END),0),coalesce(sum(CASE WHEN phase=2 THEN reserved_micro-CASE WHEN state='reserved' THEN 0 ELSE coalesce(actual_micro,reserved_micro) END ELSE 0 END),0)
    INTO charged,repair_refund FROM player_props_ai_attempts WHERE job_key=p_key;
  completed:=p_result IS NOT NULL AND p_error IS NULL AND clock_timestamp()<j.lock_at
    AND NOT EXISTS(SELECT 1 FROM player_props_ai_attempts WHERE job_key=p_key AND phase=j.phase AND state<>'completed');
  IF charged>j.reserved_micro THEN RAISE EXCEPTION 'job_charge_exceeds_reserve'; END IF;
  primary_refund:=least(j.recovery_draw_micro,greatest(0,j.reserved_micro-charged-repair_refund));
  UPDATE player_props_ai_budgets SET consumed_micro=consumed_micro-(j.reserved_micro-charged),recovery_remaining_micro=recovery_remaining_micro+repair_refund+primary_refund,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET state=CASE WHEN completed THEN 'completed' WHEN clock_timestamp()>=lock_at THEN 'expired' ELSE 'failed' END,
    result=CASE WHEN completed THEN p_result||jsonb_build_object('issuedAt',clock_timestamp(),'inputHash',input_hash,'stage',stage) ELSE NULL END,
    reserved_micro=0,recovery_draw_micro=recovery_draw_micro-primary_refund,completed_at=clock_timestamp(),error_code=CASE WHEN completed THEN NULL ELSE coalesce(p_error,'review_not_accepted_before_lock') END,updated_at=clock_timestamp() WHERE job_key=p_key RETURNING * INTO j;
  RETURN to_jsonb(j);
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_reap()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; n integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='pending' AND lock_at<=clock_timestamp() FOR UPDATE LOOP
    UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro WHERE month_key=j.billing_month;
    UPDATE player_props_ai_reviews SET state='expired',reserved_micro=0,error_code='missed_window',updated_at=clock_timestamp() WHERE job_key=j.job_key;
  END LOOP;
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='running' AND claimed_at<clock_timestamp()-interval '5 minutes' FOR UPDATE LOOP
    UPDATE player_props_ai_attempts SET state='unknown',completed_at=clock_timestamp() WHERE job_key=j.job_key AND state='sending';
    PERFORM player_props_ai_finish(j.job_key,j.claim_token,NULL,'worker_expired_unknown_reservation_retained');n:=n+1;
  END LOOP;
  RETURN n;
END $$;

ALTER TABLE public.player_props_ai_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_props_ai_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_props_ai_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_props_ai_budgets,public.player_props_ai_reviews,public.player_props_ai_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.player_props_ai_budgets,public.player_props_ai_reviews,public.player_props_ai_attempts TO service_role;
REVOKE ALL ON FUNCTION public.player_props_ai_plan(text,jsonb,text,jsonb,boolean),public.player_props_ai_claim(text,text,jsonb,boolean),public.player_props_ai_send(text,uuid,integer,integer),public.player_props_ai_receipt(uuid,uuid,bigint,text,jsonb),public.player_props_ai_repair(text,uuid),public.player_props_ai_finish(text,uuid,jsonb,text),public.player_props_ai_reap() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_plan(text,jsonb,text,jsonb,boolean),public.player_props_ai_claim(text,text,jsonb,boolean),public.player_props_ai_send(text,uuid,integer,integer),public.player_props_ai_receipt(uuid,uuid,bigint,text,jsonb),public.player_props_ai_repair(text,uuid),public.player_props_ai_finish(text,uuid,jsonb,text),public.player_props_ai_reap() TO service_role;
COMMIT;
