-- Disposable, bounded PG17 query proof; no authoritative rows are written.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE cfb_bench_ids ON COMMIT DROP AS SELECT id FROM public.cfb_forward_evidence_snapshots WHERE season=2026 AND week=9 AND stage='t60' ORDER BY captured_at DESC LIMIT 30;
ALTER TABLE cfb_bench_ids ENABLE ROW LEVEL SECURITY;
-- Materialize the exact stored JSONB once per row in a Function Scan. The
-- unchanged PostgREST paths then read that in-memory datum rather than
-- repeatedly decompressing the original TOAST value for every selected field.
-- No stored payload, hash, opening, release or history window is changed.
CREATE TEMP VIEW cfb_bench_projection
WITH (security_invoker = true)
AS SELECT
  p.id, p.season, p.evidence_release, p.provider_game_id, p.stage,
  p.captured_at, p.game_start_at, p.payload_sha256,
  CASE WHEN p.payload IS NULL THEN NULL
    ELSE COALESCE(decoded.payload, 'null'::jsonb) END AS payload
FROM public.cfb_forward_evidence_snapshots AS p
CROSS JOIN LATERAL jsonb_to_record(jsonb_build_object('payload',p.payload))
  AS decoded(payload jsonb);


CREATE TEMP TABLE cfb_bench_result(algorithm text,round int,ms numeric,plan jsonb) ON COMMIT DROP;
ALTER TABLE cfb_bench_result ENABLE ROW LEVEL SECURITY;
DO $bench$
DECLARE algo text;r int;plan json;
BEGIN
FOR r IN 1..3 LOOP
  FOREACH algo IN ARRAY CASE WHEN r=2 THEN ARRAY['projected','legacy'] ELSE ARRAY['legacy','projected'] END LOOP
    EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT p.id, p.evidence_release, p.provider_game_id, p.stage, p.captured_at, p.game_start_at, p.payload_sha256, p.payload->>''schemaRelease'' AS payload_schema_release, p.payload->''game''->>''providerGameId'' AS payload_provider_game_id, p.payload->>''stage'' AS payload_stage, p.payload->>''capturedAt'' AS payload_captured_at, p.payload->''market''->''current'' AS current, p.payload->''market''->''currentBooks'' AS current_books, p.payload->''market''->''displayBooks'' AS display_books, p.payload->''market''->''providerOpening'' AS provider_opening, p.payload->''market''->''operationalOpening'' AS operational_opening, p.payload->''market''->''playbookSplits'' AS playbook_splits, p.payload->''market''->''sharpApiSplits'' AS sharp_api_splits, p.payload->''requestBudget'' AS request_budget, p.payload->''contextualEvidenceCapture''->''markets''->''moneyline''->''families'' AS context_moneyline_families, p.payload->''contextualEvidenceCapture''->''markets''->''spread''->''families'' AS context_spread_families, p.payload->''contextualEvidenceCapture''->''markets''->''total''->''families'' AS context_total_families, p.payload->''contextualEvidenceCapture''->''markets''->''moneyline''->''targetExcludedFamilies'' AS context_moneyline_target_excluded_families, p.payload->''contextualEvidenceCapture''->''markets''->''spread''->''targetExcludedFamilies'' AS context_spread_target_excluded_families, p.payload->''contextualEvidenceCapture''->''markets''->''total''->''targetExcludedFamilies'' AS context_total_target_excluded_families FROM ' || CASE WHEN algo='legacy' THEN 'public.cfb_forward_evidence_snapshots' ELSE 'pg_temp.cfb_bench_projection' END || ' p WHERE p.id IN (SELECT id FROM pg_temp.cfb_bench_ids) ORDER BY p.captured_at,p.id' INTO plan;
    INSERT INTO cfb_bench_result VALUES(algo,r,(plan->0->>'Execution Time')::numeric,plan::jsonb);
  END LOOP;
END LOOP;
END $bench$;
WITH a AS(SELECT p.id, p.evidence_release, p.provider_game_id, p.stage, p.captured_at, p.game_start_at, p.payload_sha256, p.payload->>'schemaRelease' AS payload_schema_release, p.payload->'game'->>'providerGameId' AS payload_provider_game_id, p.payload->>'stage' AS payload_stage, p.payload->>'capturedAt' AS payload_captured_at, p.payload->'market'->'current' AS current, p.payload->'market'->'currentBooks' AS current_books, p.payload->'market'->'displayBooks' AS display_books, p.payload->'market'->'providerOpening' AS provider_opening, p.payload->'market'->'operationalOpening' AS operational_opening, p.payload->'market'->'playbookSplits' AS playbook_splits, p.payload->'market'->'sharpApiSplits' AS sharp_api_splits, p.payload->'requestBudget' AS request_budget, p.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'families' AS context_moneyline_families, p.payload->'contextualEvidenceCapture'->'markets'->'spread'->'families' AS context_spread_families, p.payload->'contextualEvidenceCapture'->'markets'->'total'->'families' AS context_total_families, p.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'targetExcludedFamilies' AS context_moneyline_target_excluded_families, p.payload->'contextualEvidenceCapture'->'markets'->'spread'->'targetExcludedFamilies' AS context_spread_target_excluded_families, p.payload->'contextualEvidenceCapture'->'markets'->'total'->'targetExcludedFamilies' AS context_total_target_excluded_families FROM public.cfb_forward_evidence_snapshots p WHERE p.id IN (SELECT id FROM pg_temp.cfb_bench_ids) ORDER BY p.captured_at,p.id),b AS(SELECT p.id, p.evidence_release, p.provider_game_id, p.stage, p.captured_at, p.game_start_at, p.payload_sha256, p.payload->>'schemaRelease' AS payload_schema_release, p.payload->'game'->>'providerGameId' AS payload_provider_game_id, p.payload->>'stage' AS payload_stage, p.payload->>'capturedAt' AS payload_captured_at, p.payload->'market'->'current' AS current, p.payload->'market'->'currentBooks' AS current_books, p.payload->'market'->'displayBooks' AS display_books, p.payload->'market'->'providerOpening' AS provider_opening, p.payload->'market'->'operationalOpening' AS operational_opening, p.payload->'market'->'playbookSplits' AS playbook_splits, p.payload->'market'->'sharpApiSplits' AS sharp_api_splits, p.payload->'requestBudget' AS request_budget, p.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'families' AS context_moneyline_families, p.payload->'contextualEvidenceCapture'->'markets'->'spread'->'families' AS context_spread_families, p.payload->'contextualEvidenceCapture'->'markets'->'total'->'families' AS context_total_families, p.payload->'contextualEvidenceCapture'->'markets'->'moneyline'->'targetExcludedFamilies' AS context_moneyline_target_excluded_families, p.payload->'contextualEvidenceCapture'->'markets'->'spread'->'targetExcludedFamilies' AS context_spread_target_excluded_families, p.payload->'contextualEvidenceCapture'->'markets'->'total'->'targetExcludedFamilies' AS context_total_target_excluded_families FROM pg_temp.cfb_bench_projection p WHERE p.id IN (SELECT id FROM pg_temp.cfb_bench_ids) ORDER BY p.captured_at,p.id) SELECT (SELECT count(*) FROM cfb_bench_ids) AS rows_checked,count(*) FILTER(WHERE to_jsonb(a) IS DISTINCT FROM to_jsonb(b)) AS mismatches,(SELECT jsonb_agg(x) FROM (SELECT algorithm,round(avg(ms),3) AS mean_ms,count(*) AS trials FROM cfb_bench_result GROUP BY algorithm)x) AS timings FROM a FULL JOIN b USING(id);
ROLLBACK;
