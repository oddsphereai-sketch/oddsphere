-- Prospective calendar reconciliation and lease-aware cleanup only.
-- No stored review/attempt/result/locked value is rewritten by installation.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
DO $$ DECLARE body text; BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text)'::regprocedure;
  IF position('reconciliation_bridge_v70' in body)=0 THEN
    IF md5(body)<>'8e18cd5f9dea4d8280faf9ea2e2e06d5' THEN RAISE EXCEPTION 'unexpected_original_calendar_reconciler'; END IF;
    body:=replace(pg_get_functiondef('public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text)'::regprocedure),'FUNCTION public.player_props_ai_plan_v3(','FUNCTION public.player_props_ai_plan_v3_legacy(');
    EXECUTE body;
  ELSIF to_regprocedure('public.player_props_ai_plan_v3_legacy(text,jsonb,jsonb,text,jsonb,text)') IS NULL THEN RAISE EXCEPTION 'original_calendar_reconciler_missing';
  ELSIF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.player_props_ai_plan_v3_legacy(text,jsonb,jsonb,text,jsonb,text)'::regprocedure)<>'8e18cd5f9dea4d8280faf9ea2e2e06d5' THEN RAISE EXCEPTION 'unexpected_preserved_calendar_reconciler';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_plan_v3_legacy(text,jsonb,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_plan_v4(p_month text,p_jobs jsonb,p_companions jsonb,p_plan_hash text,p_sources jsonb,p_release text,p_reconciliation_release text,p_calendar_capture_at timestamptz,p_calendar_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j jsonb; c jsonb; prior public.player_props_ai_reviews; cached public.player_props_ai_calendars;
  jobs jsonb:='[]'; companions jsonb:='[]'; retained jsonb:='[]'; retained_contract jsonb; effective_hash text; sources jsonb; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_reconciliation_release IS DISTINCT FROM 'player_props_ai_reconciliation_2026_11_10_r1_immutable_consumed_slots'
    OR p_release IS DISTINCT FROM 'player_props_ai_budget_2026_11_09_r5_standard_primary_and_early'
    OR p_month!~'^\d{4}-(0[1-9]|1[0-2])$' OR coalesce(p_plan_hash,'')=''
    OR jsonb_typeof(p_jobs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_jobs)>2000
    OR jsonb_typeof(p_companions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_companions)>4000
    OR jsonb_typeof(p_sources) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'versioned_calendar_reconciliation_required'; END IF;
  SELECT * INTO cached FROM public.player_props_ai_calendars WHERE month_key=p_month FOR SHARE;
  IF FOUND THEN
    -- A stale planner cannot roll back newer official day updates or poison the
    -- already valid monthly wallet. Legacy callers supply the same reference
    -- through the extra source metadata, without changing their RPC signature.
    IF cached.payload->>'revision' IS NOT NULL AND (p_calendar_revision IS DISTINCT FROM cached.payload->>'revision'
      OR p_calendar_capture_at IS DISTINCT FROM cached.captured_at)
      OR p_calendar_capture_at IS NOT NULL AND p_calendar_capture_at IS DISTINCT FROM cached.captured_at THEN
      RETURN jsonb_build_object('funded',false,'reason','calendar_reference_changed','reconciliation_release',p_reconciliation_release);
    END IF;
    IF p_calendar_capture_at IS NULL AND p_calendar_revision IS NULL AND EXISTS(SELECT 1 FROM unnest(ARRAY['nba','nfl','mlb']) s WHERE p_sources->s IS DISTINCT FROM cached.payload->'sources'->s) THEN
      RETURN jsonb_build_object('funded',false,'reason','calendar_reference_changed','reconciliation_release',p_reconciliation_release);
    END IF;
  ELSIF p_calendar_capture_at IS NOT NULL OR p_calendar_revision IS NOT NULL THEN
    RETURN jsonb_build_object('funded',false,'reason','calendar_reference_unavailable','reconciliation_release',p_reconciliation_release);
  END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    -- Validate submitted identities/clocks BEFORE authoritative retention. A
    -- stored closed slot is not a way to launder an invalid incoming contract.
    IF j->>'key' IS DISTINCT FROM concat('props-ai|',j->>'sport','|',j->>'gameId','|',j->>'gameDay','|',j->>'stage') OR j->>'stage' NOT IN ('early','final') OR j->>'billingMonth' IS DISTINCT FROM p_month
      OR (to_char((j->>'dueAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM') IS DISTINCT FROM p_month AND NOT((j->>'dueAt')::timestamptz<clock_timestamp() AND clock_timestamp()<(j->>'lock')::timestamptz AND to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')=p_month))
      OR ((j->>'start')::timestamptz AT TIME ZONE 'America/New_York')::date IS DISTINCT FROM (j->>'gameDay')::date OR ((j->>'dueAt')::timestamptz AT TIME ZONE 'America/New_York')::date IS DISTINCT FROM (j->>'gameDay')::date
      OR NOT((j->>'dueAt')::timestamptz<(j->>'lock')::timestamptz AND (j->>'lock')::timestamptz<=(j->>'start')::timestamptz) THEN RAISE EXCEPTION 'invalid_submitted_calendar_contract'; END IF;
    SELECT * INTO prior FROM public.player_props_ai_reviews WHERE job_key=j->>'key' FOR UPDATE;
    IF FOUND AND prior.state<>'pending' AND NOT(prior.state='cancelled' AND prior.error_code='complete_calendar_rescheduled_or_cancelled'
      AND NOT EXISTS(SELECT 1 FROM public.player_props_ai_attempts a WHERE a.job_key=prior.job_key)) THEN
      IF j->>'sport' IS DISTINCT FROM prior.sport OR j->>'gameId' IS DISTINCT FROM prior.game_id OR j->>'gameDay' IS DISTINCT FROM prior.game_day::text OR j->>'stage' IS DISTINCT FROM prior.stage THEN RAISE EXCEPTION 'retained_slot_identity_conflict'; END IF;
      retained_contract:=jsonb_build_object('key',prior.job_key,'sport',prior.sport,'gameId',prior.game_id,'gameDay',prior.game_day::text,'stage',prior.stage,
        'start',prior.scheduled_start,'lock',prior.lock_at,'dueAt',prior.due_at,'billingMonth',prior.billing_month);
      retained:=retained||jsonb_build_array(retained_contract);
      -- Closed prior-month usage never becomes a new-month charged obligation.
      IF prior.billing_month=p_month THEN jobs:=jobs||jsonb_build_array(j||retained_contract); END IF;
    ELSE jobs:=jobs||jsonb_build_array(j); END IF;
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(p_companions) LOOP
    -- Retain closed cross-month companions even when absent from incoming jobs.
    SELECT * INTO prior FROM public.player_props_ai_reviews WHERE job_key=c->>'key' FOR SHARE;
    IF FOUND AND prior.state<>'pending' AND NOT(prior.state='cancelled' AND prior.error_code='complete_calendar_rescheduled_or_cancelled'
      AND NOT EXISTS(SELECT 1 FROM public.player_props_ai_attempts a WHERE a.job_key=prior.job_key)) THEN
      IF c->>'sport' IS DISTINCT FROM prior.sport OR c->>'gameId' IS DISTINCT FROM prior.game_id OR c->>'gameDay' IS DISTINCT FROM prior.game_day::text OR c->>'stage' IS DISTINCT FROM prior.stage THEN RAISE EXCEPTION 'retained_companion_identity_conflict'; END IF;
      retained_contract:=jsonb_build_object('key',prior.job_key,'sport',prior.sport,'gameId',prior.game_id,'gameDay',prior.game_day::text,'stage',prior.stage,
        'start',prior.scheduled_start,'lock',prior.lock_at,'dueAt',prior.due_at,'billingMonth',prior.billing_month);
      companions:=companions||jsonb_build_array(c||retained_contract);
    ELSE companions:=companions||jsonb_build_array(c); END IF;
  END LOOP;
  effective_hash:=encode(sha256(convert_to(p_plan_hash||'|'||jobs::text||'|'||companions::text||'|'||p_reconciliation_release,'UTF8')),'hex');
  sources:=p_sources||jsonb_build_object('_reconciliation',jsonb_build_object('release',p_reconciliation_release,'inputPlanHash',p_plan_hash,'effectivePlanHash',effective_hash,'retainedStartedSlots',jsonb_array_length(retained),'retainedContractsHash',encode(sha256(convert_to(retained::text,'UTF8')),'hex')));
  result:=public.player_props_ai_plan_v3_legacy(p_month,jobs,companions,effective_hash,sources,p_release);
  RETURN result||jsonb_build_object('reconciliation_release',p_reconciliation_release,'input_plan_hash',p_plan_hash,'effective_plan_hash',effective_hash,'retained_started_slots',jsonb_array_length(retained));
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_plan_v4(text,jsonb,jsonb,text,jsonb,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_plan_v4(text,jsonb,jsonb,text,jsonb,text,text,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_plan_v3(p_month text,p_jobs jsonb,p_companions jsonb,p_plan_hash text,p_sources jsonb,p_release text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- reconciliation_bridge_v70: in-flight R29 callers also preserve consumed
  -- clocks and cannot globally poison a newer revision's funded wallet.
  RETURN public.player_props_ai_plan_v4(p_month,p_jobs,p_companions,p_plan_hash,p_sources,p_release,
    'player_props_ai_reconciliation_2026_11_10_r1_immutable_consumed_slots',(p_sources->'_calendar_revision'->>'fullCapturedAt')::timestamptz,p_sources->'_calendar_revision'->>'revision');
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_store_calendar_v1(p_month text,p_expected_capture_at timestamptz,p_expected_revision text,p_calendar jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cached public.player_props_ai_calendars; captured timestamptz; sport text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_month!~'^\d{4}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_calendar) IS DISTINCT FROM 'object' OR octet_length(p_calendar::text)>4000000
    OR p_calendar->>'month' IS DISTINCT FROM p_month OR p_calendar->>'release' IS DISTINCT FROM 'player_props_ai_calendar_2026_11_07_r1_complete_month'
    OR p_calendar->>'captureRelease' IS DISTINCT FROM 'player_props_ai_calendar_capture_2026_11_10_r2_response_completion'
    OR p_calendar->>'captureClockMeaning' IS DISTINCT FROM 'response_completion' OR coalesce(p_calendar->>'revision','')!~'^[a-f0-9-]{36}$'
    OR jsonb_typeof(p_calendar->'games') IS DISTINCT FROM 'array' OR jsonb_array_length(p_calendar->'games')>2000 THEN RAISE EXCEPTION 'invalid_complete_calendar_capture'; END IF;
  captured:=(p_calendar->>'capturedAt')::timestamptz;
  IF captured IS NULL OR captured>clock_timestamp() OR p_calendar->'sources'->'_calendar_revision'->>'revision' IS DISTINCT FROM p_calendar->>'revision'
    OR (p_calendar->'sources'->'_calendar_revision'->>'fullCapturedAt')::timestamptz IS DISTINCT FROM captured THEN RAISE EXCEPTION 'invalid_complete_calendar_clock'; END IF;
  FOREACH sport IN ARRAY ARRAY['nba','nfl','mlb'] LOOP
    IF p_calendar->'sources'->sport->'complete' IS DISTINCT FROM 'true'::jsonb OR coalesce(p_calendar->'sources'->sport->>'source','')='' THEN RAISE EXCEPTION 'complete_calendar_sources_required'; END IF;
  END LOOP;
  SELECT * INTO cached FROM public.player_props_ai_calendars WHERE month_key=p_month FOR UPDATE;
  IF FOUND AND (cached.captured_at IS DISTINCT FROM p_expected_capture_at OR cached.payload->>'revision' IS DISTINCT FROM p_expected_revision)
    OR NOT FOUND AND (p_expected_capture_at IS NOT NULL OR p_expected_revision IS NOT NULL) THEN
    RETURN jsonb_build_object('status','superseded','calendar',CASE WHEN cached.month_key IS NOT NULL THEN cached.payload ELSE NULL END);
  END IF;
  IF cached.month_key IS NOT NULL AND captured<cached.captured_at THEN RETURN jsonb_build_object('status','superseded','calendar',cached.payload); END IF;
  INSERT INTO public.player_props_ai_calendars(month_key,release,captured_at,payload) VALUES(p_month,p_calendar->>'release',captured,p_calendar)
    ON CONFLICT(month_key) DO UPDATE SET release=excluded.release,captured_at=excluded.captured_at,payload=excluded.payload;
  RETURN jsonb_build_object('status','stored','calendar',p_calendar);
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_store_calendar_v1(text,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_store_calendar_v1(text,timestamptz,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_merge_calendar_day_v1(p_month text,p_writer_run text,p_sport text,p_day date,p_full_capture_at timestamptz,p_update jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cached public.player_props_ai_calendars; fixture jsonb; old jsonb; games jsonb; requested timestamptz; available timestamptz; key text; revision text; next_payload jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  IF p_month IS NULL OR p_month!~'^\d{4}-(0[1-9]|1[0-2])$' OR p_sport IS NULL OR p_sport NOT IN ('nba','nfl','mlb') OR NOT public.player_props_ai_has_writer(p_sport,p_writer_run) OR p_day IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'America/New_York')::date
    OR p_update->>'release' IS DISTINCT FROM 'player_props_ai_calendar_day_2026_11_10_r1_bounded_official_reconciliation'
    OR jsonb_typeof(p_update->'fixtures') IS DISTINCT FROM 'array' OR jsonb_array_length(p_update->'fixtures')>=100 OR octet_length(p_update::text)>200000
    OR coalesce(p_update->>'fixtureHash','')!~'^[a-f0-9]{64}$'
    OR p_update->>'source' IS DISTINCT FROM concat('https://site.api.espn.com/apis/site/v2/sports/',CASE p_sport WHEN 'nba' THEN 'basketball/nba' WHEN 'nfl' THEN 'football/nfl' ELSE 'baseball/mlb' END,'/scoreboard?dates=',to_char(p_day,'YYYYMMDD'),'&limit=100') THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  requested:=(p_update->>'requestedAt')::timestamptz;available:=(p_update->>'availableAt')::timestamptz;
  IF requested IS NULL OR available IS NULL OR available<requested OR available>clock_timestamp() THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO cached FROM public.player_props_ai_calendars WHERE month_key=p_month FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  key:=p_sport||'|'||p_day::text;
  IF cached.captured_at IS DISTINCT FROM p_full_capture_at OR (cached.payload->'dayUpdates'->key->>'availableAt')::timestamptz>available THEN RETURN jsonb_build_object('status','superseded','calendar',cached.payload); END IF;
  IF requested<cached.captured_at OR cached.release<>'player_props_ai_calendar_2026_11_07_r1_complete_month' OR cached.payload->>'month' IS DISTINCT FROM p_month THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_update->'fixtures') f GROUP BY f->>'id' HAVING count(*)<>1) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  games:=cached.payload->'games';
  FOR fixture IN SELECT value FROM jsonb_array_elements(p_update->'fixtures') LOOP
    IF fixture->>'sport' IS DISTINCT FROM p_sport OR coalesce(fixture->>'id','')!~('^espn:'||p_sport||':[0-9]+$')
      OR coalesce(fixture->>'home','')!~'^[A-Z0-9]{2,8}$' OR coalesce(fixture->>'away','')!~'^[A-Z0-9]{2,8}$' OR fixture->>'home'=fixture->>'away'
      OR jsonb_typeof(fixture->'confirmed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(fixture->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(fixture->'lock') IS DISTINCT FROM 'string'
      OR (fixture->>'start')::timestamptz IS NULL OR (fixture->>'lock')::timestamptz IS NULL OR (fixture->>'start')::timestamptz-(fixture->>'lock')::timestamptz<>interval '60 minutes' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    SELECT value INTO old FROM jsonb_array_elements(games) WHERE value->>'id'=fixture->>'id' AND value->>'sport'=p_sport;
    IF old IS NOT NULL AND (old->>'home' IS DISTINCT FROM fixture->>'home' OR old->>'away' IS DISTINCT FROM fixture->>'away') THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    SELECT coalesce(jsonb_agg(value),'[]') INTO games FROM jsonb_array_elements(games) WHERE NOT(value->>'id'=fixture->>'id' AND value->>'sport'=p_sport);
    games:=games||jsonb_build_array(fixture);
  END LOOP;
  revision:=gen_random_uuid()::text;
  next_payload:=cached.payload||jsonb_build_object('revision',revision,'games',games,'captureClockMeaning',coalesce(cached.payload->>'captureClockMeaning','legacy_recorded_clock'),
    'sources',cached.payload->'sources'||jsonb_build_object('_calendar_revision',jsonb_build_object('revision',revision,'fullCapturedAt',cached.payload->>'capturedAt')),
    'dayUpdates',coalesce(cached.payload->'dayUpdates','{}')||jsonb_build_object(key,p_update-'fixtures'));
  UPDATE public.player_props_ai_calendars SET payload=next_payload WHERE month_key=p_month;
  RETURN jsonb_build_object('status','merged','calendar',next_payload);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('status','unavailable');
END $$;
REVOKE ALL ON FUNCTION public.player_props_ai_merge_calendar_day_v1(text,text,text,date,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_props_ai_merge_calendar_day_v1(text,text,text,date,timestamptz,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_calendar_legacy_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest timestamptz;
BEGIN
  IF OLD.payload->>'revision' IS NOT NULL AND NEW.payload->>'revision' IS NULL THEN
    SELECT max((value->>'availableAt')::timestamptz) INTO latest FROM jsonb_each(coalesce(OLD.payload->'dayUpdates','{}'));
    IF NEW.captured_at<=OLD.captured_at OR NEW.captured_at<latest THEN RETURN OLD; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS player_props_ai_calendar_legacy_guard ON public.player_props_ai_calendars;
CREATE TRIGGER player_props_ai_calendar_legacy_guard BEFORE UPDATE ON public.player_props_ai_calendars FOR EACH ROW EXECUTE FUNCTION public.player_props_ai_calendar_legacy_guard();
REVOKE ALL ON FUNCTION public.player_props_ai_calendar_legacy_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.player_props_ai_reap()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j player_props_ai_reviews; n integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('player_props_ai_wallet_v1'));
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='pending' AND lock_at<=clock_timestamp() FOR UPDATE LOOP
    UPDATE player_props_ai_budgets SET core_reserved_micro=core_reserved_micro-j.reserved_micro WHERE month_key=j.billing_month;
    UPDATE player_props_ai_reviews SET state='expired',reserved_micro=0,error_code='missed_window',updated_at=clock_timestamp() WHERE job_key=j.job_key;n:=n+1;
  END LOOP;
  FOR j IN SELECT * FROM player_props_ai_reviews WHERE state='running' AND (lock_at<=clock_timestamp() OR claimed_at<clock_timestamp()-interval '5 minutes' AND NOT player_props_ai_has_writer(sport,writer_run_id)) FOR UPDATE LOOP
    UPDATE player_props_ai_attempts SET state='unknown',completed_at=clock_timestamp() WHERE job_key=j.job_key AND state='sending';
    PERFORM player_props_ai_finish(j.job_key,j.claim_token,NULL,'worker_expired_unknown_reservation_retained');n:=n+1;
  END LOOP;
  RETURN n;
END $$;
COMMENT ON FUNCTION public.player_props_ai_reap() IS 'player_props_ai_reaper_2026_11_10_r2_exact_owner_lease; preserve active owner before lock, retain unknown charges, close stale lost-owner jobs and all after-lock jobs';
COMMIT;
