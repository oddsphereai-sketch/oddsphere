-- Additive service-only evidence archive. Existing caches and locked records
-- are not modified by this migration. The existing collector is the sole writer.
CREATE TABLE IF NOT EXISTS public.current_split_observation_archive (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport text NOT NULL CHECK(sport IN ('mlb','wnba','nhl','nba','nfl','cfb','cbb')),
  feed_release text NOT NULL,
  source text NOT NULL,
  observation_sha256 text NOT NULL CHECK(observation_sha256 ~ '^[a-f0-9]{64}$'),
  event_id text,
  event_date date,
  observed_at text,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sport,feed_release,observation_sha256)
);
CREATE INDEX IF NOT EXISTS current_split_archive_event_date_page
  ON public.current_split_observation_archive(sport,feed_release,event_date,id);
CREATE INDEX IF NOT EXISTS current_split_archive_event_page
  ON public.current_split_observation_archive(sport,feed_release,event_id,id);
ALTER TABLE public.current_split_observation_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.current_split_observation_archive FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.current_split_observation_archive TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.current_split_observation_archive_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.reject_current_split_archive_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Current split observations are immutable; append a new observation instead'; END;
$$;
DROP TRIGGER IF EXISTS current_split_archive_immutable ON public.current_split_observation_archive;
CREATE TRIGGER current_split_archive_immutable BEFORE UPDATE OR DELETE ON public.current_split_observation_archive
  FOR EACH ROW EXECUTE FUNCTION public.reject_current_split_archive_mutation();
DROP TRIGGER IF EXISTS current_split_archive_no_truncate ON public.current_split_observation_archive;
CREATE TRIGGER current_split_archive_no_truncate BEFORE TRUNCATE ON public.current_split_observation_archive
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_current_split_archive_mutation();

CREATE OR REPLACE FUNCTION public.archive_current_split_observations(observations jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(observations) IS DISTINCT FROM 'array' OR jsonb_array_length(observations)>1000
    OR octet_length(observations::text)>1000000 THEN
    RAISE EXCEPTION 'Split archive batch is invalid or exceeds its bounded transport';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(observations) r WHERE
    r->>'payload_text' IS NULL OR (r->>'payload_text')::jsonb IS DISTINCT FROM r->'payload'
    OR encode(sha256(convert_to(r->>'payload_text','UTF8')),'hex') IS DISTINCT FROM r->>'observation_sha256') THEN
    RAISE EXCEPTION 'Split archive payload checksum or JSON differs from its original evidence';
  END IF;
  INSERT INTO public.current_split_observation_archive(sport,feed_release,source,observation_sha256,event_id,event_date,observed_at,payload)
    SELECT r->>'sport',r->>'feed_release',r->>'source',r->>'observation_sha256',r->'payload'->>'event_id',
      (r->>'event_date')::date,r->'payload'->>'fetched_at',r->'payload'
    FROM jsonb_array_elements(observations) WITH ORDINALITY AS input(r,position) ORDER BY position
    ON CONFLICT(sport,feed_release,observation_sha256) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(observations) r
    LEFT JOIN public.current_split_observation_archive a ON a.sport=r->>'sport'
      AND a.feed_release=r->>'feed_release' AND a.observation_sha256=r->>'observation_sha256'
    WHERE a.id IS NULL OR a.payload IS DISTINCT FROM r->'payload'
      OR a.source IS DISTINCT FROM r->>'source' OR a.event_date IS DISTINCT FROM (r->>'event_date')::date
  ) THEN RAISE EXCEPTION 'Split archive acknowledgement differs from immutable evidence'; END IF;
  RETURN jsonb_build_object('acknowledged',jsonb_array_length(observations));
END;
$$;
REVOKE ALL ON FUNCTION public.archive_current_split_observations(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.archive_current_split_observations(jsonb) TO service_role;
COMMENT ON TABLE public.current_split_observation_archive IS
  'Append-only exact provider observation versions, including past events and all future captures before display-history trimming. No expiry or retention deletion. Raw JSONB supports historical research; current/historical readers use bounded date-scoped pages. No prediction, grade, stake, tracking or locked-member authority.';
NOTIFY pgrst,'reload schema';
