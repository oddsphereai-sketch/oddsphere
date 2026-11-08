-- Physical SELECT transport only. Preserve all stored/legacy tracking fields,
-- filters, ascending ID order, page size, and complete historical pagination.
-- Bound JSON decoding to the selected page instead of re-decoding skipped rows.
CREATE OR REPLACE FUNCTION public.tracking_prediction_records_page(
  p_sport text,p_from date,p_to date,p_competition text,p_offset integer,p_limit integer
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN
    RAISE EXCEPTION 'Invalid bounded tracking history page' USING ERRCODE='22023';
  END IF;
  RETURN (
    WITH requested_page AS MATERIALIZED (
      SELECT p.id FROM public.prediction_records p
      WHERE (p_sport IS NULL OR p.sport=p_sport)
        AND (p_from IS NULL OR p.slate_date>=p_from)
        AND (p_to IS NULL OR p.slate_date<=p_to)
        AND (p_competition IS NULL OR p.snapshot_json @> jsonb_build_object('competition',p_competition))
      ORDER BY p.id LIMIT p_limit OFFSET p_offset
    )
    SELECT coalesce(json_agg(
      (SELECT row_to_json(projected) FROM (
        SELECT
          v.id,
          v.game_prediction_id,
          v.game_id,
          v.external_id,
          v.sport,
          v.slate_date,
          v.game_date,
          v.matchup,
          v.market,
          v.pick,
          v.side,
          v.line_value,
          v.odds_american,
          v.odds_decimal,
          v.model_used,
          v.model_version,
          v.prediction_source,
          v.confidence,
          v.model_probability,
          v.market_probability,
          v.edge,
          v.expected_value,
          v.play_grade,
          v.prediction_type,
          v.best_angle,
          v.no_bet,
          v.no_bet_reason,
          v.market_aligned,
          v.data_quality_tier,
          v.source_quality,
          v.provisional,
          v.held,
          v.hold_reason,
          v.launch_day,
          v.manual_outcome_expected,
          v.locked_at,
          v.published_at,
          v.created_at,
          v.alternate_line_evidence_sha256,
          v.alternate_line_pregame_recovery,
          v.competition,
          v.member_market_at_capture,
          v.tracking_display_grade_override,
          v.member_facing_grade,
          v.tracking_correction_release,
          v.supersedes_prediction_record_id,
          v.calibration_version
        FROM public.prediction_records_tracking_projection v WHERE v.id=k.id
      ) projected)
    ),'[]'::json)
    FROM (SELECT id FROM requested_page ORDER BY id) k
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.tracking_prediction_records_page(text,date,date,text,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tracking_prediction_records_page(text,date,date,text,integer,integer)
  TO service_role;
COMMENT ON FUNCTION public.tracking_prediction_records_page(text,date,date,text,integer,integer) IS
  'Service-only invoker SELECT; exact 47-field legacy tracking projection after bounded ID paging; no mutation, retention, grade, locked-reader or model change.';
NOTIFY pgrst,'reload schema';
