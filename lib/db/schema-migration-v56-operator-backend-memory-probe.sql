-- Incident diagnostics only. Inspect the API connection executing this call,
-- without exposing SQL text, parameter values, context identifiers or rows.
-- This reports PostgreSQL contexts, not process RSS or whole-host memory.
CREATE OR REPLACE FUNCTION public.operator_backend_memory_probe()
RETURNS jsonb
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH contexts AS MATERIALIZED (
    SELECT name,total_bytes,used_bytes,free_bytes
    FROM pg_catalog.pg_backend_memory_contexts
  ), totals AS (
    SELECT count(*) AS context_count,sum(total_bytes) AS total_bytes,
      sum(used_bytes) AS used_bytes,sum(free_bytes) AS free_bytes
    FROM contexts
  ), largest AS (
    SELECT name,sum(total_bytes) AS total_bytes,sum(used_bytes) AS used_bytes,
      sum(free_bytes) AS free_bytes
    FROM contexts GROUP BY name ORDER BY sum(total_bytes) DESC,name LIMIT 12
  )
  SELECT pg_catalog.jsonb_build_object(
    'release','operator_backend_memory_probe_2026_11_02_r1',
    'sampled_at',pg_catalog.clock_timestamp(),
    'backend_pid',pg_catalog.pg_backend_pid(),
    'context_count',totals.context_count,
    'total_bytes',totals.total_bytes,'used_bytes',totals.used_bytes,
    'free_bytes',totals.free_bytes,
    'largest_contexts',(SELECT pg_catalog.jsonb_agg(largest) FROM largest),
    'prepared_statement_count',(SELECT count(*) FROM pg_catalog.pg_prepared_statements),
    'prepared_statement_text_bytes',(SELECT coalesce(sum(pg_catalog.octet_length(statement)),0)
      FROM pg_catalog.pg_prepared_statements)
  ) FROM totals;
$function$;

REVOKE ALL ON FUNCTION public.operator_backend_memory_probe()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_backend_memory_probe() TO service_role;
COMMENT ON FUNCTION public.operator_backend_memory_probe() IS
  'Service-only incident probe: current backend context allocation totals only; no arguments, SQL text, identifiers, parameters or member rows; not RSS or host memory.';
NOTIFY pgrst,'reload schema';
