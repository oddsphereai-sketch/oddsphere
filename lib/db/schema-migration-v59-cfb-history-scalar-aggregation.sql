-- Refine v58 transport only: order narrow identities and evaluate each original
-- projection as a scalar subquery inside json_agg. There is no outer join after
-- the ordered input, and no ORDER BY that sorts expanded snapshot JSON.
CREATE OR REPLACE FUNCTION public.cfb_forward_market_history_page(
  p_season integer,p_releases text[],p_game_ids text[],p_captured_after timestamptz,
  p_offset integer,p_limit integer
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF p_season IS NULL OR p_offset IS NULL OR p_offset<0 OR p_offset>=50000
    OR p_limit IS NULL OR p_limit<1 OR p_limit>1000
    OR coalesce(cardinality(p_game_ids),0)>10
    OR coalesce(cardinality(p_releases),0)>64 THEN
    RAISE EXCEPTION 'Invalid bounded CFB history page' USING ERRCODE='22023';
  END IF;
  RETURN (
  WITH requested_page AS MATERIALIZED (
    SELECT s.id,s.captured_at
    FROM public.cfb_forward_evidence_snapshots s
    WHERE s.season=p_season AND s.evidence_release=ANY(p_releases)
      AND s.provider_game_id=ANY(p_game_ids)
      AND (p_captured_after IS NULL OR s.stage='opening' OR s.captured_at>=p_captured_after)
    ORDER BY s.captured_at,s.id LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(json_agg(
    (SELECT row_to_json(projected) FROM (
      SELECT p.id,p.evidence_release,p.provider_game_id,p.stage,p.captured_at,
        p.game_start_at,p.payload_sha256,
        d.payload->>'schemaRelease' AS payload_schema_release,
        d.payload->'game'->>'providerGameId' AS payload_provider_game_id,
        d.payload->>'stage' AS payload_stage,d.payload->>'capturedAt' AS payload_captured_at,
        d.payload->'market'->'current' AS current,
        d.payload->'market'->'currentBooks' AS current_books,
        d.payload->'market'->'displayBooks' AS display_books,
        d.payload->'market'->'providerOpening' AS provider_opening,
        d.payload->'market'->'operationalOpening' AS operational_opening,
        d.payload->'market'->'playbookSplits' AS playbook_splits,
        d.payload->'market'->'sharpApiSplits' AS sharp_api_splits,
        d.payload->'requestBudget' AS request_budget,
        d.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'families' AS context_moneyline_families,
        d.payload->'contextualEvidenceCapture'->'markets'->'spread'->'families' AS context_spread_families,
        d.payload->'contextualEvidenceCapture'->'markets'->'total'->'families' AS context_total_families,
        d.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'targetExcludedFamilies' AS context_moneyline_target_excluded_families,
        d.payload->'contextualEvidenceCapture'->'markets'->'spread'->'targetExcludedFamilies' AS context_spread_target_excluded_families,
        d.payload->'contextualEvidenceCapture'->'markets'->'total'->'targetExcludedFamilies' AS context_total_target_excluded_families
      FROM public.cfb_forward_evidence_snapshots p
      CROSS JOIN LATERAL jsonb_to_record(jsonb_build_object('payload',p.payload)) AS d(payload jsonb)
      WHERE p.id=k.id
    ) projected)
  ),'[]'::json)
  FROM (SELECT id,captured_at FROM requested_page ORDER BY captured_at,id) k
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.cfb_forward_market_history_page(integer,text[],text[],timestamptz,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cfb_forward_market_history_page(integer,text[],text[],timestamptz,integer,integer)
  TO service_role;
COMMENT ON FUNCTION public.cfb_forward_market_history_page(integer,text[],text[],timestamptz,integer,integer) IS
  'Service-only invoker SELECT; exact 25-field CFB history projection, ordered narrow scalar projection before JSON expansion; no mutation, retention change or model semantics.';
NOTIFY pgrst,'reload schema';
