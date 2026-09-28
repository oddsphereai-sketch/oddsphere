-- Durable first-party analytics choices. A signed browser cookie selects this
-- record, while webhook delivery re-checks the current row so withdrawal also
-- suppresses conversions for an earlier checkout attribution.
CREATE TABLE IF NOT EXISTS public.analytics_consent_choices (
  id uuid PRIMARY KEY,
  choice text NOT NULL CHECK (choice IN ('granted', 'denied')),
  choice_set_at timestamptz NOT NULL DEFAULT now(),
  granted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.analytics_consent_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_consent_choices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.analytics_consent_choices TO service_role;

ALTER TABLE public.checkout_attributions
  ADD COLUMN IF NOT EXISTS consent_choice_id uuid
  REFERENCES public.analytics_consent_choices(id);

CREATE INDEX IF NOT EXISTS checkout_attributions_consent_choice_id
  ON public.checkout_attributions (consent_choice_id);

COMMENT ON TABLE public.analytics_consent_choices IS
  'Current signed first-party analytics choice used by both browser tags and Whop conversion delivery.';
