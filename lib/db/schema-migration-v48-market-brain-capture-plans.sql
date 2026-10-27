-- Immutable all-product capture precommit. No schedule or adapter is enabled by this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.market_brain_capture_plans (
  release text NOT NULL,
  plan_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  horizon_opens_at timestamptz NOT NULL,
  horizon_closes_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 4096),
  plan_checksum text NOT NULL CHECK (plan_checksum ~ '^[a-f0-9]{64}$'),
  plan_payload jsonb NOT NULL,
  plan_payload_text text NOT NULL,
  checksum_payload_text text NOT NULL,
  server_created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (release, plan_id),
  CHECK (release = 'market_brain_capture_plan_2026_10_27_r1_all_product_precommit'),
  CHECK (created_at <= horizon_opens_at AND horizon_opens_at < horizon_closes_at),
  CHECK (server_created_at <= horizon_opens_at),
  CHECK ((plan_payload_text::jsonb = plan_payload) IS TRUE),
  CHECK ((checksum_payload_text::jsonb = plan_payload - 'checksum') IS TRUE),
  CHECK ((encode(digest(convert_to(checksum_payload_text, 'UTF8'), 'sha256'), 'hex') = plan_checksum) IS TRUE)
);

CREATE TABLE IF NOT EXISTS public.market_brain_planned_attempts (
  plan_release text NOT NULL,
  plan_id uuid NOT NULL,
  attempt_ordinal integer NOT NULL CHECK (attempt_ordinal >= 0),
  attempt_id uuid NOT NULL UNIQUE,
  product_key text NOT NULL,
  qualification_scope_keys text[] NOT NULL CHECK (cardinality(qualification_scope_keys) > 0),
  provider text NOT NULL CHECK (length(provider) > 0),
  feed text NOT NULL CHECK (length(feed) > 0),
  participant text,
  event_id text,
  phase text NOT NULL CHECK (phase IN (
    'provider_opening', 'current', 'pregame_context', 'historical_context', 'settlement'
  )),
  planned_at timestamptz NOT NULL,
  window_opens_at timestamptz NOT NULL,
  window_closes_at timestamptz NOT NULL,
  attempt_payload jsonb NOT NULL,
  PRIMARY KEY (plan_release, plan_id, attempt_ordinal),
  FOREIGN KEY (plan_release, plan_id)
    REFERENCES public.market_brain_capture_plans(release, plan_id),
  CHECK (window_opens_at <= planned_at AND planned_at <= window_closes_at)
);

CREATE INDEX IF NOT EXISTS market_brain_planned_attempts_due
  ON public.market_brain_planned_attempts (window_opens_at, window_closes_at, planned_at);
CREATE INDEX IF NOT EXISTS market_brain_planned_attempts_product_due
  ON public.market_brain_planned_attempts (product_key, planned_at);
CREATE UNIQUE INDEX IF NOT EXISTS market_brain_planned_attempts_logical_obligation
  ON public.market_brain_planned_attempts (
    product_key, qualification_scope_keys, provider, feed, participant, event_id, phase,
    planned_at, window_opens_at, window_closes_at
  ) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.market_brain_scope_keys_are_valid(
  p_product_key text,
  p_scope_keys text[]
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  allowed text[];
  canonical text[];
BEGIN
  allowed := CASE
    WHEN p_product_key IN ('nfl_daily_edge', 'cfb_daily_edge', 'nba_daily_edge', 'wnba_daily_edge', 'nhl_daily_edge')
      THEN ARRAY['moneyline', 'spread', 'total']::text[]
    WHEN p_product_key = 'mlb_daily_edge'
      THEN ARRAY['full_game_moneyline', 'full_game_total', 'first_inning_nrfi_yrfi']::text[]
    WHEN p_product_key IN ('epl_daily_edge', 'ucl_daily_edge', 'soccer_world_cup_daily_edge')
      THEN ARRAY['match_result', 'double_chance', 'total', 'btts']::text[]
    WHEN p_product_key = 'nfl_player_props'
      THEN ARRAY[
        'passing_attempts', 'passing_completions', 'passing_yards', 'rushing_attempts', 'rushing_yards',
        'receptions', 'receiving_yards', 'passing_tds', 'interceptions', 'rushing_receiving_yards',
        'touchdowns', 'anytime_td', 'first_td', 'longest_pass', 'longest_reception', 'longest_rush',
        'fg_made', 'kicking_points'
      ]::text[]
    WHEN p_product_key = 'nba_player_props'
      THEN ARRAY[
        'points', 'rebounds', 'assists', 'threes', 'points_rebounds_assists', 'points_rebounds',
        'points_assists', 'rebounds_assists', 'blocks', 'steals', 'blocks_steals', 'turnovers',
        'field_goals', 'free_throws_made', 'free_throws_attempted', 'double_double', 'triple_double',
        'points_q1', 'rebounds_q1', 'assists_q1'
      ]::text[]
    WHEN p_product_key = 'mlb_player_props'
      THEN ARRAY[
        'pitcher_strikeouts', 'pitcher_outs', 'pitcher_hits_allowed', 'pitcher_walks',
        'pitcher_earned_runs', 'pitcher_record_a_win', 'batter_strikeouts', 'batter_hits',
        'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_runs_scored',
        'batter_hits_runs_rbis', 'batter_singles', 'batter_doubles', 'batter_triples',
        'batter_walks', 'batter_stolen_bases', 'first_home_run'
      ]::text[]
    ELSE NULL
  END;
  IF allowed IS NULL OR cardinality(p_scope_keys) < 1 THEN RETURN false; END IF;
  SELECT array_agg(scope_key ORDER BY ordinal)
    INTO canonical
    FROM unnest(allowed) WITH ORDINALITY AS allowed_scope(scope_key, ordinal)
    WHERE scope_key = ANY(p_scope_keys);
  RETURN canonical = p_scope_keys;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_market_brain_capture_plan_v1(
  p_plan_payload jsonb,
  p_plan_payload_text text,
  p_checksum_payload_text text,
  p_plan_checksum text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_release constant text := 'market_brain_capture_plan_2026_10_27_r1_all_product_precommit';
  v_plan_id uuid;
  v_created_at timestamptz;
  v_horizon_opens_at timestamptz;
  v_horizon_closes_at timestamptz;
  v_attempt_count integer;
  v_inserted integer;
  v_existing public.market_brain_capture_plans%ROWTYPE;
  v_attempt jsonb;
  v_ordinal bigint;
  v_scopes text[];
BEGIN
  IF p_plan_payload_text::jsonb IS DISTINCT FROM p_plan_payload
    OR p_checksum_payload_text::jsonb IS DISTINCT FROM p_plan_payload - 'checksum'
    OR encode(digest(convert_to(p_checksum_payload_text, 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM p_plan_checksum
    OR p_plan_payload ->> 'release' IS DISTINCT FROM v_release
    OR p_plan_payload ->> 'checksum' IS DISTINCT FROM p_plan_checksum
    OR jsonb_typeof(p_plan_payload -> 'attempts') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_plan_payload -> 'details') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'Market Brain capture-plan canonical payload is invalid';
  END IF;

  v_plan_id := (p_plan_payload ->> 'planId')::uuid;
  v_created_at := (p_plan_payload ->> 'createdAt')::timestamptz;
  v_horizon_opens_at := (p_plan_payload ->> 'horizonOpensAt')::timestamptz;
  v_horizon_closes_at := (p_plan_payload ->> 'horizonClosesAt')::timestamptz;
  v_attempt_count := jsonb_array_length(p_plan_payload -> 'attempts');

  SELECT * INTO v_existing
    FROM public.market_brain_capture_plans
    WHERE release = v_release AND plan_id = v_plan_id;
  IF FOUND THEN
    IF v_existing.plan_checksum IS DISTINCT FROM p_plan_checksum
      OR v_existing.plan_payload_text IS DISTINCT FROM p_plan_payload_text
      OR v_existing.checksum_payload_text IS DISTINCT FROM p_checksum_payload_text
      OR v_existing.plan_payload IS DISTINCT FROM p_plan_payload
    THEN
      RAISE EXCEPTION 'Market Brain capture-plan identity collision differs from immutable stored bytes';
    END IF;
    RETURN;
  END IF;

  IF v_attempt_count NOT BETWEEN 1 AND 4096
    OR v_created_at > v_horizon_opens_at
    OR v_horizon_opens_at >= v_horizon_closes_at
    OR statement_timestamp() > v_horizon_opens_at
  THEN
    RAISE EXCEPTION 'Market Brain capture plan was not precommitted before its bounded horizon';
  END IF;

  INSERT INTO public.market_brain_capture_plans (
    release, plan_id, created_at, horizon_opens_at, horizon_closes_at, attempt_count,
    plan_checksum, plan_payload, plan_payload_text, checksum_payload_text
  ) VALUES (
    v_release, v_plan_id, v_created_at, v_horizon_opens_at, v_horizon_closes_at, v_attempt_count,
    p_plan_checksum, p_plan_payload, p_plan_payload_text, p_checksum_payload_text
  ) ON CONFLICT (release, plan_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT * INTO v_existing
      FROM public.market_brain_capture_plans
      WHERE release = v_release AND plan_id = v_plan_id;
    IF NOT FOUND OR v_existing.plan_checksum IS DISTINCT FROM p_plan_checksum
      OR v_existing.plan_payload_text IS DISTINCT FROM p_plan_payload_text
      OR v_existing.checksum_payload_text IS DISTINCT FROM p_checksum_payload_text
      OR v_existing.plan_payload IS DISTINCT FROM p_plan_payload
    THEN
      RAISE EXCEPTION 'Market Brain capture-plan identity collision differs from immutable stored bytes';
    END IF;
    RETURN;
  END IF;

  FOR v_attempt, v_ordinal IN
    SELECT value, ordinality - 1
      FROM jsonb_array_elements(p_plan_payload -> 'attempts') WITH ORDINALITY
  LOOP
    v_scopes := ARRAY(SELECT jsonb_array_elements_text(v_attempt -> 'qualificationScopeKeys'));
    IF jsonb_typeof(v_attempt) IS DISTINCT FROM 'object'
      OR NOT public.market_brain_scope_keys_are_valid(v_attempt ->> 'product', v_scopes)
      OR (v_attempt ->> 'windowOpensAt')::timestamptz > (v_attempt ->> 'plannedAt')::timestamptz
      OR (v_attempt ->> 'plannedAt')::timestamptz > (v_attempt ->> 'windowClosesAt')::timestamptz
      OR (v_attempt ->> 'windowOpensAt')::timestamptz < v_horizon_opens_at
      OR (v_attempt ->> 'windowClosesAt')::timestamptz > v_horizon_closes_at
    THEN
      RAISE EXCEPTION 'Market Brain capture plan contains an invalid attempt obligation';
    END IF;
    INSERT INTO public.market_brain_planned_attempts (
      plan_release, plan_id, attempt_ordinal, attempt_id, product_key, qualification_scope_keys,
      provider, feed, participant, event_id, phase, planned_at, window_opens_at, window_closes_at,
      attempt_payload
    ) VALUES (
      v_release, v_plan_id, v_ordinal, (v_attempt ->> 'attemptId')::uuid,
      v_attempt ->> 'product', v_scopes, v_attempt ->> 'provider', v_attempt ->> 'feed',
      v_attempt ->> 'participant', v_attempt ->> 'eventId', v_attempt ->> 'phase',
      (v_attempt ->> 'plannedAt')::timestamptz, (v_attempt ->> 'windowOpensAt')::timestamptz,
      (v_attempt ->> 'windowClosesAt')::timestamptz, v_attempt
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_market_brain_evidence_attempt_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  planned public.market_brain_planned_attempts%ROWTYPE;
BEGIN
  SELECT * INTO planned FROM public.market_brain_planned_attempts WHERE attempt_id = NEW.attempt_id;
  IF NOT FOUND
    OR planned.product_key IS DISTINCT FROM NEW.product_key
    OR planned.qualification_scope_keys IS DISTINCT FROM NEW.qualification_scope_keys
    OR planned.provider IS DISTINCT FROM NEW.provider
    OR planned.feed IS DISTINCT FROM NEW.feed
    OR planned.participant IS DISTINCT FROM NEW.participant
    OR planned.event_id IS DISTINCT FROM NEW.event_id
    OR planned.phase IS DISTINCT FROM NEW.phase
    OR planned.planned_at IS DISTINCT FROM NEW.planned_at
    OR planned.window_opens_at IS DISTINCT FROM NEW.window_opens_at
    OR planned.window_closes_at IS DISTINCT FROM NEW.window_closes_at
  THEN
    RAISE EXCEPTION 'Market Brain evidence attempt is unplanned or differs from its immutable precommit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_brain_evidence_attempts_plan_validate
  ON public.market_brain_evidence_attempts;
CREATE TRIGGER market_brain_evidence_attempts_plan_validate
  BEFORE INSERT ON public.market_brain_evidence_attempts
  FOR EACH ROW EXECUTE FUNCTION public.validate_market_brain_evidence_attempt_plan();

CREATE OR REPLACE FUNCTION public.reject_market_brain_capture_plan_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Market Brain capture plans and attempt obligations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_brain_capture_plans_immutable
  ON public.market_brain_capture_plans;
CREATE TRIGGER market_brain_capture_plans_immutable
  BEFORE UPDATE OR DELETE ON public.market_brain_capture_plans
  FOR EACH ROW EXECUTE FUNCTION public.reject_market_brain_capture_plan_mutation();
DROP TRIGGER IF EXISTS market_brain_planned_attempts_immutable
  ON public.market_brain_planned_attempts;
CREATE TRIGGER market_brain_planned_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.market_brain_planned_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_market_brain_capture_plan_mutation();

ALTER TABLE public.market_brain_capture_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_brain_planned_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_brain_capture_plans FROM anon, authenticated;
REVOKE ALL ON public.market_brain_planned_attempts FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_market_brain_capture_plan_v1(jsonb, text, text, text) FROM PUBLIC;
GRANT SELECT ON public.market_brain_capture_plans TO service_role;
GRANT SELECT ON public.market_brain_planned_attempts TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_market_brain_capture_plan_v1(jsonb, text, text, text) TO service_role;
