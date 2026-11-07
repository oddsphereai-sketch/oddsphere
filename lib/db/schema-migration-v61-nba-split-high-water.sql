-- Exact read-only NBA split frontier; no index/row/retention changes.
-- Filter through existing event indexes before MAX, including absent future
-- events, rather than scanning unrelated global IDs backwards under LIMIT 1.
CREATE OR REPLACE FUNCTION public.nba_market_split_observation_high_water(p_event_ids text[])
RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
 WITH matching_ids AS MATERIALIZED (
  SELECT id FROM public.market_split_observations_v2
  WHERE league='nba' AND canonical_event_id=ANY(p_event_ids)
 ) SELECT max(id) FROM matching_ids;
$function$;
REVOKE ALL ON FUNCTION public.nba_market_split_observation_high_water(text[])
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nba_market_split_observation_high_water(text[]) TO service_role;
COMMENT ON FUNCTION public.nba_market_split_observation_high_water(text[]) IS
 'Service-only exact existing NBA/event MAX(id); invoker rights, no new data admission, history truncation or mutation.';
NOTIFY pgrst,'reload schema';
