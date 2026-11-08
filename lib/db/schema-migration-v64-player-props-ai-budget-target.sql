-- Owner-approved $50 operating target and $60 emergency ceiling. No paid activation.
-- Existing receipts, forecasts and locks stay unchanged. Optional upgrades cannot use emergency funds.
BEGIN;
ALTER TABLE public.player_props_ai_budgets DROP CONSTRAINT IF EXISTS player_props_ai_budgets_cap_micro_check;
ALTER TABLE public.player_props_ai_budgets ADD CONSTRAINT player_props_ai_budgets_cap_micro_check CHECK(cap_micro BETWEEN 0 AND 60000000);
ALTER TABLE public.player_props_ai_budgets ALTER COLUMN cap_micro SET DEFAULT 60000000;
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS target_micro bigint NOT NULL DEFAULT 50000000 CHECK(target_micro BETWEEN 0 AND 50000000);
UPDATE public.player_props_ai_budgets SET cap_micro=60000000 WHERE cap_micro=50000000 AND month_key>=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM');
CREATE OR REPLACE FUNCTION public.player_props_ai_plan_v2(p_month text,p_jobs jsonb,p_companions jsonb,p_plan_hash text,p_sources jsonb,p_release text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b player_props_ai_budgets; j jsonb; c jsonb; prior player_props_ai_reviews; primary_total bigint:=0; fallback_target bigint; fallback_delta bigint; required bigint; standard bigint; primary_cost bigint; final_count integer; moved_months text[]:=ARRAY[]::text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_month!~'^\d{4}-(0[1-9]|1[0-2])$' OR p_release IS DISTINCT FROM 'player_props_ai_budget_2026_11_08_r4_target_and_emergency' OR coalesce(p_plan_hash,'')='' OR jsonb_typeof(p_jobs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_jobs)>2000 OR jsonb_typeof(p_companions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete_versioned_calendar_required'; END IF;
  FOR c IN SELECT to_jsonb(s) FROM unnest(ARRAY['nba','nfl','mlb']) s LOOP
    IF p_sources->(c#>>'{}')->'complete' IS DISTINCT FROM 'true'::jsonb OR coalesce(p_sources->(c#>>'{}')->>'source','')='' THEN RAISE EXCEPTION 'all_sport_calendar_sources_required'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) v GROUP BY v->>'key' HAVING count(*)<>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_companions) v GROUP BY v->>'key' HAVING count(*)<>1) THEN RAISE EXCEPTION 'duplicate_calendar_slot'; END IF;
  -- Every touched game date has exactly an early and a final, including UTC boundaries.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_companions) v GROUP BY v->>'sport',v->>'gameId',v->>'gameDay' HAVING count(*)<>2 OR count(DISTINCT v->>'stage')<>2 OR bool_or(v->>'stage' NOT IN ('early','final'))) THEN RAISE EXCEPTION 'two_review_companions_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_companions) v WHERE v->>'billingMonth'=p_month AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) x WHERE x->>'key'=v->>'key')) THEN RAISE EXCEPTION 'calendar_omits_review'; END IF;
  INSERT INTO player_props_ai_budgets(month_key) VALUES(p_month) ON CONFLICT DO NOTHING;
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=p_month FOR UPDATE;
  IF EXISTS(SELECT 1 FROM player_props_ai_reviews r WHERE billing_month=p_month AND state='pending' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) x WHERE x->>'key'=r.job_key)) THEN RAISE EXCEPTION 'cannot_silently_drop_pending_reviews'; END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    IF j->>'key' IS DISTINCT FROM concat('props-ai|',j->>'sport','|',j->>'gameId','|',j->>'gameDay','|',j->>'stage') OR j->>'stage' NOT IN ('early','final') OR
      (to_char((j->>'dueAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM') IS DISTINCT FROM p_month AND NOT ((j->>'dueAt')::timestamptz<clock_timestamp() AND clock_timestamp()<(j->>'lock')::timestamptz AND to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')=p_month)) OR
      j->>'billingMonth' IS DISTINCT FROM p_month OR ((j->>'start')::timestamptz AT TIME ZONE 'America/New_York')::date IS DISTINCT FROM (j->>'gameDay')::date OR ((j->>'dueAt')::timestamptz AT TIME ZONE 'America/New_York')::date IS DISTINCT FROM (j->>'gameDay')::date OR NOT ((j->>'dueAt')::timestamptz<(j->>'lock')::timestamptz AND (j->>'lock')::timestamptz<=(j->>'start')::timestamptz) THEN RAISE EXCEPTION 'invalid_calendar_identity_or_clock'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_companions) x WHERE x=j-'requests') THEN RAISE EXCEPTION 'missing_exact_companion'; END IF;
    standard:=player_props_ai_quote(j->'requests',false,false); primary_cost:=player_props_ai_quote(j->'requests',false,j->>'stage'='early');
    SELECT * INTO prior FROM player_props_ai_reviews WHERE job_key=j->>'key';
    IF FOUND AND prior.state<>'pending' THEN
      IF prior.scheduled_start<>(j->>'start')::timestamptz OR prior.lock_at<>(j->>'lock')::timestamptz OR prior.due_at<>(j->>'dueAt')::timestamptz OR prior.billing_month<>p_month THEN RAISE EXCEPTION 'started_review_is_immutable'; END IF;
    ELSE primary_total:=primary_total+primary_cost;
    END IF;
  END LOOP;
  SELECT coalesce(sum(cost),0) INTO fallback_target FROM (
    SELECT player_props_ai_quote(v->'requests',false,false) AS cost FROM jsonb_array_elements(p_jobs) v WHERE v->>'stage'='early'
    ORDER BY cost DESC LIMIT (SELECT ceil(count(*)*.1)::integer FROM jsonb_array_elements(p_jobs) x WHERE x->>'stage'='early')
  ) q;
  fallback_delta:=greatest(0,fallback_target-b.fallback_target_micro);
  required:=primary_total+b.consumed_micro+b.fallback_remaining_micro+fallback_delta+b.recovery_remaining_micro;
  IF required>b.cap_micro OR b.unexpected_overrun_micro>0 THEN
    UPDATE player_props_ai_budgets SET full_calendar=false,funding_error='complete_primary_plan_exceeds_monthly_cap',updated_at=clock_timestamp() WHERE month_key=p_month RETURNING * INTO b;
    RETURN jsonb_build_object('funded',false,'reason',b.funding_error,'required_micro',required,'budget',to_jsonb(b));
  END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    SELECT * INTO prior FROM player_props_ai_reviews WHERE job_key=j->>'key';
    IF FOUND AND prior.state='pending' AND prior.billing_month<>p_month THEN
      UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-prior.reserved_micro,updated_at=clock_timestamp() WHERE month_key=prior.billing_month;
      moved_months:=array_append(moved_months,prior.billing_month);
    END IF;
    INSERT INTO player_props_ai_reviews(job_key,sport,game_id,game_day,stage,scheduled_start,lock_at,due_at,billing_month,reserved_micro,planned_primary_micro,standard_bound_micro,planned_requests,requested_tier)
    VALUES(j->>'key',j->>'sport',j->>'gameId',(j->>'gameDay')::date,j->>'stage',(j->>'start')::timestamptz,(j->>'lock')::timestamptz,(j->>'dueAt')::timestamptz,p_month,player_props_ai_quote(j->'requests',false,j->>'stage'='early'),player_props_ai_quote(j->'requests',false,j->>'stage'='early'),player_props_ai_quote(j->'requests'),j->'requests',CASE WHEN j->>'stage'='early' THEN 'flex' ELSE 'default' END)
    ON CONFLICT(job_key) DO UPDATE SET scheduled_start=excluded.scheduled_start,lock_at=excluded.lock_at,due_at=excluded.due_at,billing_month=excluded.billing_month,reserved_micro=excluded.reserved_micro,planned_primary_micro=excluded.planned_primary_micro,standard_bound_micro=excluded.standard_bound_micro,planned_requests=excluded.planned_requests,requested_tier=excluded.requested_tier WHERE player_props_ai_reviews.state='pending';
  END LOOP;
  UPDATE player_props_ai_budgets b0 SET planned_games=(SELECT count(*) FROM player_props_ai_reviews r WHERE r.billing_month=b0.month_key AND stage='final' AND state<>'cancelled') WHERE month_key=ANY(moved_months);
  SELECT count(*) INTO final_count FROM player_props_ai_reviews WHERE billing_month=p_month AND stage='final' AND state<>'cancelled';
  UPDATE player_props_ai_budgets SET core_reserved_micro=primary_total,fallback_remaining_micro=fallback_remaining_micro+fallback_delta,fallback_target_micro=greatest(fallback_target_micro,fallback_target),planned_games=final_count,full_calendar=true,funding_error=NULL,policy_release=p_release,plan_hash=p_plan_hash,calendar_sources=p_sources,updated_at=clock_timestamp() WHERE month_key=p_month RETURNING * INTO b;
  RETURN jsonb_build_object('funded',true,'budget',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_claim(p_key text,p_hash text,p_requests jsonb,p_prefer_stronger boolean,p_writer_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; b player_props_ai_budgets; chosen text:='gpt-6-luna'; charge bigint; strong_charge bigint; contingency bigint:=0; token uuid:=gen_random_uuid(); n integer; r jsonb; free bigint; optional_free bigint; need bigint; fdraw bigint; rdraw bigint; strong_ok boolean:=true;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'pending' THEN RETURN jsonb_build_object('claimed',false,'reason','not_pending'); END IF;
  IF NOT player_props_ai_has_writer(j.sport,p_writer_run) THEN RETURN jsonb_build_object('claimed',false,'reason','shared_sport_writer_lease_required'); END IF;
  IF clock_timestamp()<j.due_at THEN RETURN jsonb_build_object('claimed',false,'reason','not_due'); END IF;
  IF clock_timestamp()>=j.lock_at THEN RETURN jsonb_build_object('claimed',false,'reason','after_lock'); END IF;
  IF (clock_timestamp() AT TIME ZONE 'America/New_York')::date<>j.game_day THEN RETURN jsonb_build_object('claimed',false,'reason','not_game_day'); END IF;
  IF j.billing_month<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') THEN RETURN jsonb_build_object('claimed',false,'reason','billing_month_rollover_requires_replan'); END IF;
  charge:=player_props_ai_quote(p_requests); IF coalesce(p_hash,'')='' THEN RAISE EXCEPTION 'input_hash_required'; END IF;
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=j.billing_month FOR UPDATE;
  IF b.full_calendar IS NOT TRUE OR b.policy_release IS DISTINCT FROM 'player_props_ai_budget_2026_11_08_r4_target_and_emergency' OR b.unexpected_overrun_micro>0 THEN RETURN jsonb_build_object('claimed',false,'reason','complete_month_not_funded'); END IF;
  IF (SELECT count(*) FROM player_props_ai_reviews WHERE state='running')>=2 THEN RETURN jsonb_build_object('claimed',false,'reason','global_concurrency_busy'); END IF;
  free:=b.cap_micro-b.consumed_micro-b.core_reserved_micro-b.fallback_remaining_micro-b.recovery_remaining_micro;
  optional_free:=greatest(0,least(b.target_micro,b.cap_micro)-b.consumed_micro-b.core_reserved_micro-b.fallback_remaining_micro-b.recovery_remaining_micro);
  BEGIN strong_charge:=player_props_ai_quote(p_requests,true,false); EXCEPTION WHEN OTHERS THEN strong_ok:=false; END;
  -- A stronger final must also fund its entire primary fallback from optional money.
  IF p_prefer_stronger AND j.stage='final' AND strong_ok AND b.stronger_finals<floor(b.planned_games*.1)
    AND (SELECT count(*) FROM player_props_ai_reviews WHERE game_day=j.game_day AND stage='final' AND model='gpt-6.1-terra')<floor((SELECT count(*) FROM player_props_ai_reviews WHERE game_day=j.game_day AND stage='final' AND state<>'cancelled')*.1)
    AND optional_free>=strong_charge+charge-j.reserved_micro THEN chosen:='gpt-6.1-terra';contingency:=charge;charge:=strong_charge+contingency; END IF;
  need:=greatest(0,charge-j.reserved_micro-free); fdraw:=least(need,b.fallback_remaining_micro); rdraw:=need-fdraw;
  IF rdraw>b.recovery_remaining_micro THEN RETURN jsonb_build_object('claimed',false,'reason','primary_packet_funding_gap'); END IF;
  UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro,consumed_micro=consumed_micro+charge,fallback_remaining_micro=fallback_remaining_micro-fdraw,recovery_remaining_micro=recovery_remaining_micro-rdraw,stronger_finals=stronger_finals+CASE WHEN chosen='gpt-6.1-terra' THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET state='running',claim_token=token,claimed_at=clock_timestamp(),writer_run_id=p_writer_run,model=chosen,parts=jsonb_array_length(p_requests),phase=1,input_hash=p_hash,reserved_micro=charge,fallback_draw_micro=fdraw,recovery_draw_micro=rdraw,contingency_micro=contingency,requested_tier=CASE WHEN stage='early' THEN 'flex' ELSE 'default' END,updated_at=clock_timestamp() WHERE job_key=p_key RETURNING * INTO j;
  FOR n IN 1..j.parts LOOP
    r:=p_requests->(n-1);
    INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro,requested_tier,input_bound,primary_input_bound,output_bound) VALUES(p_key,1,n,chosen,player_props_ai_quote(jsonb_build_array(r),chosen='gpt-6.1-terra',false),j.requested_tier,(r->>CASE WHEN chosen='gpt-6.1-terra' THEN 'strong_input_tokens' ELSE 'input_tokens' END)::integer,(r->>'input_tokens')::integer,(r->>'max_output_tokens')::integer);
  END LOOP;
  RETURN jsonb_build_object('claimed',true,'token',token,'job',to_jsonb(j));
END $$;


COMMIT;
