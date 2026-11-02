-- Materialize the exact stored JSONB once per row in a Function Scan. The
-- unchanged PostgREST paths then read that in-memory datum rather than
-- repeatedly decompressing the original TOAST value for every selected field.
-- No stored payload, hash, opening, release or history window is changed.
CREATE OR REPLACE VIEW public.cfb_forward_market_history_projection
WITH (security_invoker = true)
AS SELECT
  p.id, p.season, p.evidence_release, p.provider_game_id, p.stage,
  p.captured_at, p.game_start_at, p.payload_sha256,
  CASE WHEN p.payload IS NULL THEN NULL
    ELSE COALESCE(decoded.payload, 'null'::jsonb) END AS payload
FROM public.cfb_forward_evidence_snapshots AS p
CROSS JOIN LATERAL jsonb_to_record(jsonb_build_object('payload',p.payload))
  AS decoded(payload jsonb);

REVOKE ALL ON public.cfb_forward_market_history_projection FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cfb_forward_market_history_projection TO service_role;
COMMENT ON VIEW public.cfb_forward_market_history_projection IS
  'Exact legacy payload materialized once; original reader paths and invoker RLS; SELECT-only.';
NOTIFY pgrst, 'reload schema';
