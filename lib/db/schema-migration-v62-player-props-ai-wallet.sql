-- Apply after v61. No member prediction, locked record, collector or cron is changed.
-- Integer microdollars. HTTP is always outside these short wallet transactions.
BEGIN;
ALTER TABLE public.player_props_ai_budgets ALTER COLUMN cap_micro SET DEFAULT 50000000;
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS fallback_remaining_micro bigint NOT NULL DEFAULT 0 CHECK(fallback_remaining_micro>=0);
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS fallback_target_micro bigint NOT NULL DEFAULT 0 CHECK(fallback_target_micro>=0);
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS unexpected_overrun_micro bigint NOT NULL DEFAULT 0 CHECK(unexpected_overrun_micro>=0);
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS policy_release text;
ALTER TABLE public.player_props_ai_budgets ADD COLUMN IF NOT EXISTS funding_error text;
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS requested_tier text NOT NULL DEFAULT 'default' CHECK(requested_tier IN ('default','flex'));
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS planned_requests jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS planned_primary_micro bigint NOT NULL DEFAULT 0;
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS standard_bound_micro bigint NOT NULL DEFAULT 0;
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS fallback_draw_micro bigint NOT NULL DEFAULT 0 CHECK(fallback_draw_micro>=0);
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS contingency_micro bigint NOT NULL DEFAULT 0 CHECK(contingency_micro>=0);
ALTER TABLE public.player_props_ai_reviews ADD COLUMN IF NOT EXISTS writer_run_id text;
ALTER TABLE public.player_props_ai_attempts ADD COLUMN IF NOT EXISTS requested_tier text NOT NULL DEFAULT 'default' CHECK(requested_tier IN ('default','flex'));
ALTER TABLE public.player_props_ai_attempts ADD COLUMN IF NOT EXISTS input_bound integer;
ALTER TABLE public.player_props_ai_attempts ADD COLUMN IF NOT EXISTS primary_input_bound integer;
ALTER TABLE public.player_props_ai_attempts ADD COLUMN IF NOT EXISTS output_bound integer;
ALTER TABLE public.player_props_ai_attempts ADD COLUMN IF NOT EXISTS failure_reason text;
-- Actual receipts must remain recordable even when the vendor violates an envelope.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.player_props_ai_budgets'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%core_reserved_micro%consumed_micro%' LOOP
    EXECUTE format('ALTER TABLE public.player_props_ai_budgets DROP CONSTRAINT %I',c.conname);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.player_props_ai_attempts'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%actual_micro%reserved_micro%' LOOP
    EXECUTE format('ALTER TABLE public.player_props_ai_attempts DROP CONSTRAINT %I',c.conname);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.player_props_ai_reviews'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%parts%' LOOP
    EXECUTE format('ALTER TABLE public.player_props_ai_reviews DROP CONSTRAINT %I',c.conname);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.player_props_ai_attempts'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%part %' LOOP
    EXECUTE format('ALTER TABLE public.player_props_ai_attempts DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
ALTER TABLE public.player_props_ai_reviews ADD CONSTRAINT props_ai_parts_bound CHECK(parts BETWEEN 1 AND 16);
ALTER TABLE public.player_props_ai_attempts ADD CONSTRAINT props_ai_part_bound CHECK(part BETWEEN 1 AND 16);
ALTER TABLE public.player_props_ai_budgets ADD CONSTRAINT props_ai_wallet_funding CHECK(core_reserved_micro+consumed_micro+fallback_remaining_micro+recovery_remaining_micro<=cap_micro+unexpected_overrun_micro);
ALTER TABLE public.player_props_ai_attempts DROP CONSTRAINT IF EXISTS props_ai_actual_nonnegative;
ALTER TABLE public.player_props_ai_attempts ADD CONSTRAINT props_ai_actual_nonnegative CHECK(actual_micro>=0);

CREATE OR REPLACE FUNCTION public.player_props_ai_quote(p_requests jsonb,p_strong boolean DEFAULT false,p_flex boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE r jsonb; total bigint:=0; i integer; o integer;
BEGIN
  IF jsonb_typeof(p_requests) IS DISTINCT FROM 'array' OR jsonb_array_length(p_requests) NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'invalid_funded_partition_count'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_requests) LOOP
    IF coalesce(r->>CASE WHEN p_strong THEN 'strong_input_tokens' ELSE 'input_tokens' END,'')!~'^\d+$' OR coalesce(r->>'max_output_tokens','')!~'^\d+$' THEN RAISE EXCEPTION 'missing_integer_request_bounds'; END IF;
    i:=(r->>CASE WHEN p_strong THEN 'strong_input_tokens' ELSE 'input_tokens' END)::integer; o:=(r->>'max_output_tokens')::integer;
    IF i NOT BETWEEN 1 AND 145000 OR o NOT BETWEEN 1 AND 7000 THEN RAISE EXCEPTION 'request_exceeds_counted_bound'; END IF;
    total:=total+ceil(((i+2048)::numeric*.1+o::numeric*.5)*CASE WHEN p_strong THEN 10 ELSE 1 END*CASE WHEN p_flex THEN .5 ELSE 1 END)::bigint;
  END LOOP;
  RETURN total;
END $$;

-- Disable legacy flat-allowance planning/repair. Old clients cannot fund a new month.
DROP FUNCTION IF EXISTS public.player_props_ai_plan(text,jsonb,text,jsonb,boolean);
DROP FUNCTION IF EXISTS public.player_props_ai_repair(text,uuid);
CREATE OR REPLACE FUNCTION public.player_props_ai_plan_v2(p_month text,p_jobs jsonb,p_companions jsonb,p_plan_hash text,p_sources jsonb,p_release text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b player_props_ai_budgets; j jsonb; c jsonb; prior player_props_ai_reviews; primary_total bigint:=0; fallback_target bigint; fallback_delta bigint; required bigint; standard bigint; primary_cost bigint; final_count integer; moved_months text[]:=ARRAY[]::text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_month!~'^\d{4}-(0[1-9]|1[0-2])$' OR p_release IS DISTINCT FROM 'player_props_ai_budget_2026_11_07_r3_full_source_wallet' OR coalesce(p_plan_hash,'')='' OR jsonb_typeof(p_jobs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_jobs)>2000 OR jsonb_typeof(p_companions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete_versioned_calendar_required'; END IF;
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

CREATE OR REPLACE FUNCTION public.player_props_ai_has_writer(p_sport text,p_run text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
BEGIN
  IF to_regclass('public.cron_job_leases') IS NULL OR coalesce(p_run,'')='' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.cron_job_leases WHERE job_name='prediction_pipeline:'||p_sport AND run_id=p_run AND lease_expires_at>clock_timestamp());
END $$;
DROP FUNCTION IF EXISTS public.player_props_ai_claim(text,text,jsonb,boolean);
CREATE OR REPLACE FUNCTION public.player_props_ai_claim(p_key text,p_hash text,p_requests jsonb,p_prefer_stronger boolean,p_writer_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; b player_props_ai_budgets; chosen text:='gpt-6-luna'; charge bigint; strong_charge bigint; contingency bigint:=0; token uuid:=gen_random_uuid(); n integer; r jsonb; free bigint; need bigint; fdraw bigint; rdraw bigint; strong_ok boolean:=true;
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
  IF b.full_calendar IS NOT TRUE OR b.policy_release IS DISTINCT FROM 'player_props_ai_budget_2026_11_07_r3_full_source_wallet' OR b.unexpected_overrun_micro>0 THEN RETURN jsonb_build_object('claimed',false,'reason','complete_month_not_funded'); END IF;
  IF (SELECT count(*) FROM player_props_ai_reviews WHERE state='running')>=2 THEN RETURN jsonb_build_object('claimed',false,'reason','global_concurrency_busy'); END IF;
  free:=b.cap_micro-b.consumed_micro-b.core_reserved_micro-b.fallback_remaining_micro-b.recovery_remaining_micro;
  BEGIN strong_charge:=player_props_ai_quote(p_requests,true,false); EXCEPTION WHEN OTHERS THEN strong_ok:=false; END;
  -- A stronger final must also fund its entire primary fallback from optional money.
  IF p_prefer_stronger AND j.stage='final' AND strong_ok AND b.stronger_finals<floor(b.planned_games*.1) AND free>=strong_charge+charge-j.reserved_micro THEN chosen:='gpt-6.1-terra';contingency:=charge;charge:=strong_charge+contingency; END IF;
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

CREATE OR REPLACE FUNCTION public.player_props_ai_send(p_key text,p_token uuid,p_phase integer,p_part integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; a player_props_ai_attempts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'running' OR j.claim_token IS DISTINCT FROM p_token OR j.phase<>p_phase OR clock_timestamp()>=j.lock_at OR j.billing_month<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') OR NOT player_props_ai_has_writer(j.sport,j.writer_run_id) THEN RAISE EXCEPTION 'invalid_or_expired_send_claim'; END IF;
  IF EXISTS(SELECT 1 FROM player_props_ai_budgets WHERE month_key=j.billing_month AND unexpected_overrun_micro>0) THEN RAISE EXCEPTION 'wallet_frozen_vendor_overrun'; END IF;
  UPDATE player_props_ai_attempts SET state='sending',started_at=clock_timestamp() WHERE job_key=p_key AND phase=p_phase AND part=p_part AND state='reserved' RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_already_claimed'; END IF;
  RETURN to_jsonb(a);
END $$;

-- Refunds restore protected pools before becoming optional upgrade money.
CREATE OR REPLACE FUNCTION public.player_props_ai_release(p_key text,p_refund bigint)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; rr bigint; fr bigint;
BEGIN
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  rr:=least(j.recovery_draw_micro,greatest(0,p_refund));fr:=least(j.fallback_draw_micro,greatest(0,p_refund-rr));
  UPDATE player_props_ai_budgets SET consumed_micro=consumed_micro-p_refund,recovery_remaining_micro=recovery_remaining_micro+rr,fallback_remaining_micro=fallback_remaining_micro+fr,unexpected_overrun_micro=unexpected_overrun_micro+greatest(0,-p_refund),full_calendar=CASE WHEN p_refund<0 THEN false ELSE full_calendar END,funding_error=CASE WHEN p_refund<0 THEN 'vendor_usage_exceeds_reserved_bound' ELSE funding_error END,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET recovery_draw_micro=recovery_draw_micro-rr,fallback_draw_micro=fallback_draw_micro-fr WHERE job_key=p_key;
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_receipt(p_id uuid,p_token uuid,p_actual bigint,p_response text,p_usage jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a player_props_ai_attempts; j player_props_ai_reviews;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO a FROM player_props_ai_attempts WHERE id=p_id FOR UPDATE;
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=a.job_key FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_token OR a.state NOT IN ('sending','completed','unknown') THEN RAISE EXCEPTION 'invalid_receipt_claim'; END IF;
  IF a.state='completed' THEN
    IF a.actual_micro IS DISTINCT FROM p_actual OR a.response_id IS DISTINCT FROM p_response OR a.usage IS DISTINCT FROM p_usage THEN RAISE EXCEPTION 'immutable_usage_receipt_conflict'; END IF; RETURN;
  END IF;
  IF a.response_id IS NOT NULL AND p_response IS NOT NULL AND a.response_id<>p_response THEN RAISE EXCEPTION 'response_identity_conflict'; END IF;
  IF p_actual<0 THEN RAISE EXCEPTION 'negative_usage'; END IF;
  IF j.state='running' AND p_actual>a.reserved_micro THEN
    -- Record/freeze immediately, before the worker can authorize a fallback.
    PERFORM player_props_ai_release(j.job_key,a.reserved_micro-p_actual);
    UPDATE player_props_ai_reviews SET reserved_micro=reserved_micro+(p_actual-a.reserved_micro) WHERE job_key=j.job_key;
  END IF;
  IF j.state<>'running' AND p_actual IS NOT NULL THEN PERFORM player_props_ai_release(j.job_key,a.reserved_micro-p_actual); END IF;
  UPDATE player_props_ai_attempts SET actual_micro=p_actual,response_id=coalesce(p_response,response_id),usage=coalesce(p_usage,usage),state=CASE WHEN p_actual IS NULL THEN 'unknown' ELSE 'completed' END,completed_at=clock_timestamp() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_fallback(p_key text,p_token uuid,p_parts integer[],p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; b player_props_ai_budgets; charge bigint; additional bigint; free bigint; need bigint; fdraw bigint; rdraw bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.state<>'running' OR j.claim_token IS DISTINCT FROM p_token OR j.phase<>1 OR clock_timestamp()+interval '20 seconds'>=j.lock_at OR j.billing_month<>to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') OR coalesce(cardinality(p_parts),0)=0 OR coalesce(p_reason,'')='' THEN RETURN false; END IF;
  IF NOT player_props_ai_has_writer(j.sport,j.writer_run_id) THEN RETURN false; END IF;
  IF cardinality(p_parts)<>(SELECT count(DISTINCT x) FROM unnest(p_parts) x) OR EXISTS(SELECT 1 FROM unnest(p_parts) n WHERE n NOT BETWEEN 1 AND j.parts) THEN RAISE EXCEPTION 'invalid_fallback_parts'; END IF;
  -- No blind retry after a timeout or other unknown completion, even on other parts.
  IF EXISTS(SELECT 1 FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1 AND state<>'completed') THEN RETURN false; END IF;
  SELECT sum(ceil((primary_input_bound+2048)::numeric*.1+output_bound::numeric*.5)) INTO charge FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1 AND part=ANY(p_parts);
  additional:=greatest(0,charge-j.contingency_micro);
  SELECT * INTO b FROM player_props_ai_budgets WHERE month_key=j.billing_month FOR UPDATE;
  IF b.unexpected_overrun_micro>0 THEN RETURN false; END IF;
  free:=b.cap_micro-b.consumed_micro-b.core_reserved_micro-b.fallback_remaining_micro-b.recovery_remaining_micro;
  need:=greatest(0,additional-free);fdraw:=least(need,b.fallback_remaining_micro);rdraw:=need-fdraw;
  IF rdraw>b.recovery_remaining_micro THEN RETURN false; END IF;
  UPDATE player_props_ai_budgets SET consumed_micro=consumed_micro+additional,fallback_remaining_micro=fallback_remaining_micro-fdraw,recovery_remaining_micro=recovery_remaining_micro-rdraw,updated_at=clock_timestamp() WHERE month_key=j.billing_month;
  UPDATE player_props_ai_reviews SET phase=2,reserved_micro=reserved_micro+additional,fallback_draw_micro=fallback_draw_micro+fdraw,recovery_draw_micro=recovery_draw_micro+rdraw,contingency_micro=greatest(0,contingency_micro-charge),claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE job_key=p_key;
  INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro,requested_tier,input_bound,primary_input_bound,output_bound,failure_reason)
    SELECT p_key,2,part,'gpt-6-luna',ceil((primary_input_bound+2048)::numeric*.1+output_bound::numeric*.5)::bigint,'default',primary_input_bound,primary_input_bound,output_bound,left(p_reason,160) FROM player_props_ai_attempts WHERE job_key=p_key AND phase=1 AND part=ANY(p_parts);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_finish(p_key text,p_token uuid,p_result jsonb,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; charged bigint; completed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  SELECT * INTO j FROM player_props_ai_reviews WHERE job_key=p_key FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'wrong_finish_claim'; END IF;
  IF j.state<>'running' THEN RETURN to_jsonb(j); END IF;
  SELECT coalesce(sum(CASE WHEN state='reserved' THEN 0 ELSE coalesce(actual_micro,reserved_micro) END),0) INTO charged FROM player_props_ai_attempts WHERE job_key=p_key;
  completed:=p_result IS NOT NULL AND p_error IS NULL AND clock_timestamp()<j.lock_at AND player_props_ai_has_writer(j.sport,j.writer_run_id) AND NOT EXISTS(
    SELECT 1 FROM player_props_ai_attempts a WHERE job_key=p_key AND phase=(SELECT max(phase) FROM player_props_ai_attempts x WHERE x.job_key=p_key AND x.part=a.part) AND state<>'completed'
  ) AND (SELECT count(DISTINCT part) FROM player_props_ai_attempts WHERE job_key=p_key)=j.parts;
  PERFORM player_props_ai_release(p_key,j.reserved_micro-charged);
  UPDATE player_props_ai_reviews SET state=CASE WHEN completed THEN 'completed' WHEN clock_timestamp()>=lock_at THEN 'expired' ELSE 'failed' END,result=CASE WHEN completed THEN p_result||jsonb_build_object('issuedAt',clock_timestamp(),'inputHash',input_hash,'stage',stage) ELSE NULL END,reserved_micro=0,contingency_micro=0,completed_at=clock_timestamp(),error_code=CASE WHEN completed THEN NULL ELSE coalesce(p_error,'review_not_accepted_before_lock') END,updated_at=clock_timestamp() WHERE job_key=p_key RETURNING * INTO j;
  RETURN to_jsonb(j);
END $$;

CREATE OR REPLACE FUNCTION public.player_props_ai_reap()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; n integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='pending' AND lock_at<=clock_timestamp() FOR UPDATE LOOP
    UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro WHERE month_key=j.billing_month;
    UPDATE player_props_ai_reviews SET state='expired',reserved_micro=0,error_code='missed_window',updated_at=clock_timestamp() WHERE job_key=j.job_key;n:=n+1;
  END LOOP;
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='running' AND claimed_at<clock_timestamp()-interval '5 minutes' FOR UPDATE LOOP
    UPDATE player_props_ai_attempts SET state='unknown',completed_at=clock_timestamp() WHERE job_key=j.job_key AND state='sending';
    PERFORM player_props_ai_finish(j.job_key,j.claim_token,NULL,'worker_expired_unknown_reservation_retained');n:=n+1;
  END LOOP;
  RETURN n;
END $$;

-- Revoke by namespace, including private helpers: no implicit PUBLIC execute.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'player_props_ai_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
    IF f.proname NOT IN ('player_props_ai_quote','player_props_ai_release','player_props_ai_has_writer') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
  END LOOP;
END $$;
COMMIT;
