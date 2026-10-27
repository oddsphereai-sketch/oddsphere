-- Leased, restart-safe due-work claims. Applying this migration schedules no runner or provider call.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.market_brain_attempt_claims (
  attempt_id uuid PRIMARY KEY REFERENCES public.market_brain_planned_attempts(attempt_id),
  claim_release text NOT NULL,
  claim_token uuid NOT NULL UNIQUE,
  claim_mode text NOT NULL CHECK (claim_mode IN ('due', 'missed_window_reconcile')),
  claimed_by text NOT NULL CHECK (claimed_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  claim_sequence integer NOT NULL CHECK (claim_sequence >= 1),
  finalized_at timestamptz,
  CHECK (claim_release = 'market_brain_attempt_claim_2026_10_27_r2_adapter_parser_bound_due_and_missed'),
  CHECK (claimed_at < lease_expires_at),
  CHECK (finalized_at IS NULL OR finalized_at >= claimed_at)
);

CREATE TABLE IF NOT EXISTS public.market_brain_attempt_claim_history (
  claim_token uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES public.market_brain_planned_attempts(attempt_id),
  claim_release text NOT NULL,
  claim_mode text NOT NULL CHECK (claim_mode IN ('due', 'missed_window_reconcile')),
  claimed_by text NOT NULL,
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  claim_sequence integer NOT NULL CHECK (claim_sequence >= 1),
  UNIQUE (attempt_id, claim_sequence),
  CHECK (claim_release = 'market_brain_attempt_claim_2026_10_27_r2_adapter_parser_bound_due_and_missed'),
  CHECK (claimed_at < lease_expires_at)
);

CREATE INDEX IF NOT EXISTS market_brain_attempt_claims_lease
  ON public.market_brain_attempt_claims (lease_expires_at) WHERE finalized_at IS NULL;
CREATE INDEX IF NOT EXISTS market_brain_attempt_claim_history_attempt
  ON public.market_brain_attempt_claim_history (attempt_id, claim_sequence);

CREATE OR REPLACE FUNCTION public.claim_market_brain_attempts_internal_v1(
  p_claim_release text,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer,
  p_claim_mode text
) RETURNS TABLE (
  attempt_id uuid,
  product_key text,
  qualification_scope_keys text[],
  provider text,
  feed text,
  adapter_release text,
  parser_release text,
  participant text,
  event_id text,
  phase text,
  planned_at timestamptz,
  window_opens_at timestamptz,
  window_closes_at timestamptz,
  claim_release text,
  claim_token uuid,
  claim_mode text,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claim_sequence integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  planned public.market_brain_planned_attempts%ROWTYPE;
  claimed public.market_brain_attempt_claims%ROWTYPE;
BEGIN
  IF p_claim_release <> 'market_brain_attempt_claim_2026_10_27_r2_adapter_parser_bound_due_and_missed'
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 300
    OR p_claim_mode NOT IN ('due', 'missed_window_reconcile')
  THEN
    RAISE EXCEPTION 'Market Brain claim arguments are invalid';
  END IF;

  FOR planned IN
    SELECT planned_attempt.*
      FROM public.market_brain_planned_attempts planned_attempt
      LEFT JOIN public.market_brain_attempt_claims current_claim
        ON current_claim.attempt_id = planned_attempt.attempt_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.market_brain_evidence_attempts receipt
        WHERE receipt.attempt_id = planned_attempt.attempt_id
     )
       AND (current_claim.attempt_id IS NULL OR
         (current_claim.finalized_at IS NULL AND current_claim.lease_expires_at <= v_now))
       AND ((p_claim_mode = 'due' AND planned_attempt.window_opens_at <= v_now
             AND planned_attempt.planned_at <= v_now
             AND planned_attempt.window_closes_at >= v_now) OR
            (p_claim_mode = 'missed_window_reconcile' AND planned_attempt.window_closes_at < v_now))
     ORDER BY CASE WHEN p_claim_mode = 'due' THEN planned_attempt.planned_at ELSE planned_attempt.window_closes_at END,
       planned_attempt.attempt_id
     LIMIT p_limit
     FOR UPDATE OF planned_attempt SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(planned.attempt_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.market_brain_evidence_attempts receipt
       WHERE receipt.attempt_id = planned.attempt_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.market_brain_attempt_claims (
      attempt_id, claim_release, claim_token, claim_mode, claimed_by, claimed_at,
      lease_expires_at, claim_sequence, finalized_at
    ) VALUES (
      planned.attempt_id, p_claim_release, gen_random_uuid(), p_claim_mode, p_worker_id, v_now,
      v_now + make_interval(secs => p_lease_seconds), 1, NULL
    )
    ON CONFLICT ON CONSTRAINT market_brain_attempt_claims_pkey DO UPDATE SET
      claim_release = EXCLUDED.claim_release,
      claim_token = EXCLUDED.claim_token,
      claim_mode = EXCLUDED.claim_mode,
      claimed_by = EXCLUDED.claimed_by,
      claimed_at = EXCLUDED.claimed_at,
      lease_expires_at = EXCLUDED.lease_expires_at,
      claim_sequence = public.market_brain_attempt_claims.claim_sequence + 1,
      finalized_at = NULL
    WHERE public.market_brain_attempt_claims.finalized_at IS NULL
      AND public.market_brain_attempt_claims.lease_expires_at <= v_now
    RETURNING * INTO claimed;
    IF NOT FOUND THEN CONTINUE; END IF;

    INSERT INTO public.market_brain_attempt_claim_history (
      claim_token, attempt_id, claim_release, claim_mode, claimed_by, claimed_at,
      lease_expires_at, claim_sequence
    ) VALUES (
      claimed.claim_token, claimed.attempt_id, claimed.claim_release, claimed.claim_mode,
      claimed.claimed_by, claimed.claimed_at, claimed.lease_expires_at, claimed.claim_sequence
    );

    RETURN QUERY SELECT
      planned.attempt_id, planned.product_key, planned.qualification_scope_keys,
      planned.provider, planned.feed, planned.adapter_release, planned.parser_release,
      planned.participant, planned.event_id, planned.phase,
      planned.planned_at, planned.window_opens_at, planned.window_closes_at,
      claimed.claim_release, claimed.claim_token, claimed.claim_mode, claimed.claimed_by,
      claimed.claimed_at, claimed.lease_expires_at, claimed.claim_sequence;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_market_brain_attempts_v1(
  p_claim_release text,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) RETURNS TABLE (
  attempt_id uuid,
  product_key text,
  qualification_scope_keys text[],
  provider text,
  feed text,
  adapter_release text,
  parser_release text,
  participant text,
  event_id text,
  phase text,
  planned_at timestamptz,
  window_opens_at timestamptz,
  window_closes_at timestamptz,
  claim_release text,
  claim_token uuid,
  claim_mode text,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claim_sequence integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.claim_market_brain_attempts_internal_v1(
    p_claim_release, p_worker_id, p_limit, p_lease_seconds, 'due'
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_expired_market_brain_attempts_v1(
  p_claim_release text,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
) RETURNS TABLE (
  attempt_id uuid,
  product_key text,
  qualification_scope_keys text[],
  provider text,
  feed text,
  adapter_release text,
  parser_release text,
  participant text,
  event_id text,
  phase text,
  planned_at timestamptz,
  window_opens_at timestamptz,
  window_closes_at timestamptz,
  claim_release text,
  claim_token uuid,
  claim_mode text,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claim_sequence integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.claim_market_brain_attempts_internal_v1(
    p_claim_release, p_worker_id, p_limit, p_lease_seconds, 'missed_window_reconcile'
  );
$$;

CREATE OR REPLACE FUNCTION public.serialize_market_brain_evidence_attempt_with_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_claim public.market_brain_attempt_claims%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.attempt_id::text, 0));
  SELECT * INTO active_claim
    FROM public.market_brain_attempt_claims
   WHERE attempt_id = NEW.attempt_id;
  IF NOT FOUND
    OR active_claim.finalized_at IS NOT NULL
    OR active_claim.claim_release IS DISTINCT FROM NEW.claim_release
    OR active_claim.claim_token IS DISTINCT FROM NEW.claim_token
    OR active_claim.claim_mode IS DISTINCT FROM NEW.claim_mode
    OR active_claim.claim_sequence IS DISTINCT FROM NEW.claim_sequence
    OR active_claim.lease_expires_at <= statement_timestamp()
  THEN
    RAISE EXCEPTION 'Market Brain evidence receipt does not match the exact active claim token and sequence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_market_brain_attempt_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.market_brain_attempt_claims
     SET finalized_at = NEW.server_created_at
   WHERE attempt_id = NEW.attempt_id AND claim_token = NEW.claim_token
     AND claim_sequence = NEW.claim_sequence AND finalized_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_brain_evidence_attempts_00_serialize_claim
  ON public.market_brain_evidence_attempts;
CREATE TRIGGER market_brain_evidence_attempts_00_serialize_claim
  BEFORE INSERT ON public.market_brain_evidence_attempts
  FOR EACH ROW EXECUTE FUNCTION public.serialize_market_brain_evidence_attempt_with_claim();
DROP TRIGGER IF EXISTS market_brain_evidence_attempts_finalize_claim
  ON public.market_brain_evidence_attempts;
CREATE TRIGGER market_brain_evidence_attempts_finalize_claim
  AFTER INSERT ON public.market_brain_evidence_attempts
  FOR EACH ROW EXECUTE FUNCTION public.finalize_market_brain_attempt_claim();

CREATE OR REPLACE FUNCTION public.reject_market_brain_claim_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Market Brain claim history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_brain_attempt_claim_history_immutable
  ON public.market_brain_attempt_claim_history;
CREATE TRIGGER market_brain_attempt_claim_history_immutable
  BEFORE UPDATE OR DELETE ON public.market_brain_attempt_claim_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_market_brain_claim_history_mutation();

ALTER TABLE public.market_brain_attempt_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_brain_attempt_claim_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_brain_attempt_claims FROM anon, authenticated;
REVOKE ALL ON public.market_brain_attempt_claim_history FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_market_brain_attempts_internal_v1(text, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_market_brain_attempts_v1(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_expired_market_brain_attempts_v1(text, text, integer, integer) FROM PUBLIC;
GRANT SELECT ON public.market_brain_attempt_claims TO service_role;
GRANT SELECT ON public.market_brain_attempt_claim_history TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_market_brain_attempts_v1(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_expired_market_brain_attempts_v1(text, text, integer, integer) TO service_role;
