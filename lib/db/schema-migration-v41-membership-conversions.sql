-- Private attribution relay. Only the opaque UUID crosses into Whop metadata;
-- Google Analytics cookie identifiers remain inside OddSphere.
CREATE TABLE IF NOT EXISTS public.checkout_attributions (
  id uuid PRIMARY KEY,
  ga_client_id text NOT NULL CHECK (char_length(ga_client_id) BETWEEN 1 AND 128),
  ga_session_id text CHECK (ga_session_id IS NULL OR char_length(ga_session_id) BETWEEN 1 AND 256),
  ga_measurement_id text NOT NULL CHECK (char_length(ga_measurement_id) BETWEEN 3 AND 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX IF NOT EXISTS checkout_attributions_expires_at
  ON public.checkout_attributions (expires_at);

ALTER TABLE public.checkout_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_attributions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.checkout_attributions TO service_role;

COMMENT ON TABLE public.checkout_attributions IS
  'Private GA attribution lookup keyed by the opaque UUID copied to Whop checkout metadata.';

-- Delivery ledger. The conversion key is membership-scoped, so duplicate or
-- reordered Whop deliveries cannot create a second trial or first-payment send.
CREATE TABLE IF NOT EXISTS public.membership_conversion_events (
  conversion_key text PRIMARY KEY,
  conversion_kind text NOT NULL CHECK (conversion_kind IN ('trial', 'first_paid')),
  source_webhook_id text NOT NULL,
  membership_id text NOT NULL,
  payment_id text,
  plan_id text NOT NULL,
  product_id text,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_conversion_events_payment_id
  ON public.membership_conversion_events (payment_id)
  WHERE payment_id IS NOT NULL;

ALTER TABLE public.membership_conversion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.membership_conversion_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.membership_conversion_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_membership_conversion_event(
  p_conversion_key text,
  p_conversion_kind text,
  p_source_webhook_id text,
  p_membership_id text,
  p_payment_id text,
  p_plan_id text,
  p_product_id text,
  p_occurred_at timestamptz
)
RETURNS TABLE (claimed boolean, current_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.membership_conversion_events (
    conversion_key, conversion_kind, source_webhook_id, membership_id,
    payment_id, plan_id, product_id, occurred_at
  ) VALUES (
    p_conversion_key, p_conversion_kind, p_source_webhook_id, p_membership_id,
    p_payment_id, p_plan_id, p_product_id, p_occurred_at
  )
  ON CONFLICT (conversion_key) DO UPDATE
    SET status = 'processing',
        source_webhook_id = EXCLUDED.source_webhook_id,
        attempts = membership_conversion_events.attempts + 1,
        claimed_at = now(),
        updated_at = now(),
        last_error = NULL
    WHERE membership_conversion_events.status = 'failed'
       OR (
         membership_conversion_events.status = 'processing'
         AND membership_conversion_events.claimed_at < now() - interval '5 minutes'
       )
  RETURNING true, membership_conversion_events.status;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, e.status
    FROM public.membership_conversion_events e
    WHERE e.conversion_key = p_conversion_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_membership_conversion_event(
  text, text, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_membership_conversion_event(
  text, text, text, text, text, text, text, timestamptz
) TO service_role;

COMMENT ON TABLE public.membership_conversion_events IS
  'Idempotent server-side delivery ledger for confirmed Whop trial and first-paid GA events.';
