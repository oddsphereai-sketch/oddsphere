-- Physical query/transport optimization only. Existing values, filters,
-- timestamps, constraints, RLS, writer ownership and release identifiers remain
-- authoritative. No index build, retention change or host restart is required.

-- A single unnamed JSONB argument makes PostgREST pass the request body
-- directly, avoiding json_to_record's oversized materialized tuple/spill.
CREATE OR REPLACE FUNCTION public.upsert_lab_response_snapshot(jsonb)
RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  INSERT INTO public.lab_response_snapshots(
    snapshot_key,kind,sport,slate_date,payload,payload_version,source,
    generated_at,expires_at,stale_until,updated_at
  ) VALUES (
    $1->>'snapshot_key',$1->>'kind',$1->>'sport',($1->>'slate_date')::date,
    $1->'payload',$1->>'payload_version',$1->>'source',
    ($1->>'generated_at')::timestamptz,($1->>'expires_at')::timestamptz,
    ($1->>'stale_until')::timestamptz,($1->>'updated_at')::timestamptz
  ) ON CONFLICT(snapshot_key) DO UPDATE SET
    kind=excluded.kind,sport=excluded.sport,slate_date=excluded.slate_date,
    payload=excluded.payload,payload_version=excluded.payload_version,
    source=excluded.source,generated_at=excluded.generated_at,
    expires_at=excluded.expires_at,stale_until=excluded.stale_until,
    updated_at=excluded.updated_at;
$function$;
REVOKE ALL ON FUNCTION public.upsert_lab_response_snapshot(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.upsert_lab_response_snapshot(jsonb) TO service_role;
COMMENT ON FUNCTION public.upsert_lab_response_snapshot(jsonb) IS
  'Service-only physical transport for the existing snapshot writer; exact eleven-column upsert, invoker privileges, no payload reinterpretation.';

-- Filter through the existing event index before finding the largest id.
-- This is the same maximum as ORDER BY id DESC LIMIT 1, without allowing that
-- LIMIT to select a backward primary-key scan over unrelated events.
CREATE OR REPLACE FUNCTION public.market_price_observation_high_water(
  p_league text,p_event_ids text[]
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  WITH matching_ids AS MATERIALIZED (
    SELECT id FROM public.market_price_observations_v2
    WHERE league=p_league AND canonical_event_id=ANY(p_event_ids)
  ) SELECT max(id) FROM matching_ids;
$function$;
REVOKE ALL ON FUNCTION public.market_price_observation_high_water(text,text[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.market_price_observation_high_water(text,text[]) TO service_role;
COMMENT ON FUNCTION public.market_price_observation_high_water(text,text[]) IS
  'Service-only exact maximum id for the unchanged league/event predicate; no history window, truncation, mutation or new model semantics.';

NOTIFY pgrst,'reload schema';
