-- Read the exact legacy snapshot fields after one JSON record decode instead
-- of repeatedly detoasting the same large document for each PostgREST alias.
-- Stored records, payloads, grades, prices and evidence are never rewritten.
CREATE OR REPLACE VIEW public.prediction_records_tracking_projection
WITH (security_invoker = true)
AS
SELECT
  p.*,
  j.evidence_payload_sha256 AS alternate_line_evidence_sha256,
  j.published_pregame_recovery AS alternate_line_pregame_recovery,
  j.competition,
  j.member_market_at_capture,
  j.tracking_display_grade_override,
  j.member_facing_at_lock ->> 'grade' AS member_facing_grade,
  j.tracking_correction_release,
  j.supersedes_prediction_record_id
FROM public.prediction_records AS p
CROSS JOIN LATERAL jsonb_to_record(
  CASE WHEN jsonb_typeof(p.snapshot_json) = 'object'
    THEN p.snapshot_json ELSE '{}'::jsonb END
) AS j(
  evidence_payload_sha256 text,
  published_pregame_recovery jsonb,
  competition text,
  member_market_at_capture jsonb,
  tracking_display_grade_override text,
  member_facing_at_lock jsonb,
  tracking_correction_release text,
  supersedes_prediction_record_id jsonb
);

REVOKE ALL ON public.prediction_records_tracking_projection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prediction_records_tracking_projection TO service_role;
COMMENT ON VIEW public.prediction_records_tracking_projection IS
  'Exact legacy tracking fields from immutable stored JSON; invoker RLS and SELECT-only service access.';
NOTIFY pgrst, 'reload schema';
