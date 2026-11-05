-- Additive service-only evidence archive. Existing caches and locked records
-- are not modified by this migration. The existing collector is the sole writer.
CREATE TABLE IF NOT EXISTS public.current_split_capture_archive (
  id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  capture_sha256 text NOT NULL CHECK(capture_sha256 ~ '^[a-f0-9]{64}$'),
  part integer NOT NULL CHECK(part>=0), parts integer NOT NULL CHECK(parts>0 AND part<parts),
  sport text NOT NULL, feed_release text NOT NULL, source text NOT NULL,
  capture_kind text NOT NULL CHECK(capture_kind IN ('baseline','capture')),
  fetched_at timestamptz NOT NULL, decoded_bytes bigint NOT NULL CHECK(decoded_bytes>=0),
  row_count integer NOT NULL CHECK(row_count>=0), payload text NOT NULL CHECK(octet_length(payload)<=180000),
  part_sha256 text NOT NULL CHECK(part_sha256 ~ '^[a-f0-9]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(capture_sha256,part)
);
CREATE INDEX IF NOT EXISTS current_split_capture_lookup ON public.current_split_capture_archive(sport,feed_release,fetched_at,id);
ALTER TABLE public.current_split_capture_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.current_split_capture_archive FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.current_split_capture_archive TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.current_split_capture_archive_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.current_split_observation_archive (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport text NOT NULL CHECK(sport IN ('mlb','wnba','nhl','nba','nfl','cfb','cbb')),
  feed_release text NOT NULL,
  source text NOT NULL,
  observation_sha256 text NOT NULL CHECK(observation_sha256 ~ '^[a-f0-9]{64}$'),
  event_book_key text NOT NULL,
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
CREATE INDEX IF NOT EXISTS current_split_archive_group_order
  ON public.current_split_observation_archive(sport,feed_release,event_book_key,id);
CREATE INDEX IF NOT EXISTS current_split_archive_all_page
  ON public.current_split_observation_archive(sport,feed_release,id);
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
DROP TRIGGER IF EXISTS current_split_capture_immutable ON public.current_split_capture_archive;
CREATE TRIGGER current_split_capture_immutable BEFORE UPDATE OR DELETE ON public.current_split_capture_archive
  FOR EACH ROW EXECUTE FUNCTION public.reject_current_split_archive_mutation();
DROP TRIGGER IF EXISTS current_split_capture_no_truncate ON public.current_split_capture_archive;
CREATE TRIGGER current_split_capture_no_truncate BEFORE TRUNCATE ON public.current_split_capture_archive
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_current_split_archive_mutation();

CREATE OR REPLACE FUNCTION public.archive_current_split_capture_part(receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v_saved public.current_split_capture_archive%ROWTYPE;
BEGIN
  IF octet_length(receipt::text)>250000 OR encode(sha256(convert_to(receipt->>'payload','UTF8')),'hex') IS DISTINCT FROM receipt->>'part_sha256' THEN
    RAISE EXCEPTION 'Original split capture part is invalid or exceeds its bounded transport';
  END IF;
  INSERT INTO public.current_split_capture_archive(capture_sha256,part,parts,sport,feed_release,source,capture_kind,fetched_at,decoded_bytes,row_count,payload,part_sha256)
    VALUES(receipt->>'capture_sha256',(receipt->>'part')::integer,(receipt->>'parts')::integer,receipt->>'sport',receipt->>'feed_release',
      receipt->>'source',receipt->>'capture_kind',(receipt->>'fetched_at')::timestamptz,(receipt->>'decoded_bytes')::bigint,
      (receipt->>'row_count')::integer,receipt->>'payload',receipt->>'part_sha256') ON CONFLICT(capture_sha256,part) DO NOTHING;
  SELECT * INTO v_saved FROM public.current_split_capture_archive WHERE capture_sha256=receipt->>'capture_sha256' AND part=(receipt->>'part')::integer;
  IF v_saved.payload IS DISTINCT FROM receipt->>'payload' OR v_saved.part_sha256 IS DISTINCT FROM receipt->>'part_sha256'
    OR v_saved.parts IS DISTINCT FROM (receipt->>'parts')::integer OR v_saved.decoded_bytes IS DISTINCT FROM (receipt->>'decoded_bytes')::bigint
    OR v_saved.row_count IS DISTINCT FROM (receipt->>'row_count')::integer OR v_saved.sport IS DISTINCT FROM receipt->>'sport'
    OR v_saved.feed_release IS DISTINCT FROM receipt->>'feed_release' OR v_saved.source IS DISTINCT FROM receipt->>'source'
    OR v_saved.fetched_at IS DISTINCT FROM (receipt->>'fetched_at')::timestamptz THEN
    RAISE EXCEPTION 'Original split capture differs from immutable stored receipt';
  END IF;
  RETURN jsonb_build_object('acknowledged',true);
END;
$$;
REVOKE ALL ON FUNCTION public.archive_current_split_capture_part(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.archive_current_split_capture_part(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.archive_current_split_observations(observations jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v_orders jsonb;
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
  INSERT INTO public.current_split_observation_archive(sport,feed_release,source,observation_sha256,event_book_key,event_id,event_date,observed_at,payload)
    SELECT r->>'sport',r->>'feed_release',r->>'source',r->>'observation_sha256',r->>'event_book_key',r->'payload'->>'event_id',
      (r->>'event_date')::date,r->'payload'->>'fetched_at',r->'payload'
    FROM jsonb_array_elements(observations) WITH ORDINALITY AS input(r,position) ORDER BY position
    ON CONFLICT(sport,feed_release,observation_sha256) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(observations) r
    LEFT JOIN public.current_split_observation_archive a ON a.sport=r->>'sport'
      AND a.feed_release=r->>'feed_release' AND a.observation_sha256=r->>'observation_sha256'
    WHERE a.id IS NULL OR a.payload IS DISTINCT FROM r->'payload'
      OR a.source IS DISTINCT FROM r->>'source' OR a.event_date IS DISTINCT FROM (r->>'event_date')::date
      OR a.event_book_key IS DISTINCT FROM r->>'event_book_key'
  ) THEN RAISE EXCEPTION 'Split archive acknowledgement differs from immutable evidence'; END IF;
  SELECT jsonb_object_agg(g.event_book_key,g.first_id) INTO v_orders FROM (
    SELECT a.event_book_key,min(a.id) AS first_id FROM public.current_split_observation_archive a
    JOIN (SELECT DISTINCT r->>'sport' AS sport,r->>'feed_release' AS feed_release,r->>'event_book_key' AS group_key
      FROM jsonb_array_elements(observations) r) requested
      ON a.sport=requested.sport AND a.feed_release=requested.feed_release AND a.event_book_key=requested.group_key
    GROUP BY a.event_book_key
  ) g;
  RETURN jsonb_build_object('acknowledged',jsonb_array_length(observations),'group_orders',coalesce(v_orders,'{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.archive_current_split_observations(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.archive_current_split_observations(jsonb) TO service_role;
COMMENT ON TABLE public.current_split_observation_archive IS
  'Append-only exact provider observation versions, including past events and all future captures before display-history trimming. No expiry or retention deletion. Raw JSONB supports historical research; current/historical readers use bounded date-scoped pages. No prediction, grade, stake, tracking or locked-member authority.';

-- This is a rebuildable retained-display index, not an observation or public
-- record. Keeping the existing JS trim result here prevents cold reads from
-- resurrecting observations that the display history had already evicted.
CREATE TABLE IF NOT EXISTS public.current_split_group_history (
  sport text NOT NULL, feed_release text NOT NULL, group_key text NOT NULL,
  source text NOT NULL, event_dates date[] NOT NULL,
  first_observation_id bigint NOT NULL REFERENCES public.current_split_observation_archive(id),
  fetched_at timestamptz NOT NULL, payload jsonb NOT NULL,
  observation_sha256s text[] NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(sport,feed_release,group_key), UNIQUE(sport,feed_release,first_observation_id)
);
CREATE INDEX IF NOT EXISTS current_split_group_history_order ON public.current_split_group_history(sport,feed_release,first_observation_id);
CREATE INDEX IF NOT EXISTS current_split_group_history_dates ON public.current_split_group_history USING gin(event_dates);
ALTER TABLE public.current_split_group_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.current_split_group_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.current_split_group_history TO service_role;

CREATE OR REPLACE FUNCTION public.save_current_split_group_history(history jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(history) IS DISTINCT FROM 'array' OR jsonb_array_length(history)>1000 OR octet_length(history::text)>1000000 THEN
    RAISE EXCEPTION 'Retained history batch exceeds its bounded transport';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(history) r WHERE (r->>'payload_text')::jsonb IS DISTINCT FROM r->'payload'
    OR encode(sha256(convert_to(r->>'payload_text','UTF8')),'hex') IS DISTINCT FROM r->>'payload_sha256'
    OR (r->>'first_observation_id')::bigint IS DISTINCT FROM (SELECT min(a.id) FROM public.current_split_observation_archive a
      WHERE a.sport=r->>'sport' AND a.feed_release=r->>'feed_release' AND a.event_book_key=r->>'group_key')) THEN
    RAISE EXCEPTION 'Retained history checksum or original group order is invalid';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(history) r CROSS JOIN LATERAL jsonb_array_elements_text(r->'observation_sha256s') h
    WHERE NOT EXISTS(SELECT 1 FROM public.current_split_observation_archive a WHERE a.sport=r->>'sport'
      AND a.feed_release=r->>'feed_release' AND a.event_book_key=r->>'group_key' AND a.observation_sha256=h.value)) THEN
    RAISE EXCEPTION 'Retained history references an observation not yet preserved in the immutable archive';
  END IF;
  INSERT INTO public.current_split_group_history(sport,feed_release,group_key,source,event_dates,first_observation_id,fetched_at,payload,payload_sha256,observation_sha256s)
    SELECT r->>'sport',r->>'feed_release',r->>'group_key',r->>'source',
      ARRAY(SELECT jsonb_array_elements_text(r->'event_dates'))::date[],(r->>'first_observation_id')::bigint,
      (r->>'fetched_at')::timestamptz,r->'payload',r->>'payload_sha256',ARRAY(SELECT jsonb_array_elements_text(r->'observation_sha256s')) FROM jsonb_array_elements(history) r
    ON CONFLICT(sport,feed_release,group_key) DO UPDATE SET source=excluded.source,event_dates=excluded.event_dates,
      fetched_at=excluded.fetched_at,payload=excluded.payload,payload_sha256=excluded.payload_sha256,observation_sha256s=excluded.observation_sha256s
    WHERE excluded.fetched_at>=public.current_split_group_history.fetched_at;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(history) r LEFT JOIN public.current_split_group_history h
    ON h.sport=r->>'sport' AND h.feed_release=r->>'feed_release' AND h.group_key=r->>'group_key'
    WHERE h.payload_sha256 IS DISTINCT FROM r->>'payload_sha256') THEN
    RAISE EXCEPTION 'Retained history acknowledgement is incomplete or a newer source receipt already exists';
  END IF;
  RETURN jsonb_build_object('acknowledged',jsonb_array_length(history));
END;
$$;

CREATE OR REPLACE FUNCTION public.read_current_split_group_history(p_sport text,p_release text,
  p_event_dates date[],p_group_keys text[],p_after_order bigint)
RETURNS TABLE(group_key text,first_observation_id bigint,payload jsonb,observation_sha256s text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT h.group_key,h.first_observation_id,h.payload,h.observation_sha256s FROM public.current_split_group_history h
  WHERE h.sport=p_sport AND h.feed_release=p_release AND h.first_observation_id>p_after_order
    AND (p_event_dates IS NULL OR h.event_dates&&p_event_dates)
    AND (p_group_keys IS NULL OR h.group_key=ANY(p_group_keys))
  ORDER BY h.first_observation_id LIMIT 5;
$$;
REVOKE ALL ON FUNCTION public.save_current_split_group_history(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_current_split_group_history(text,text,date[],text[],bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_current_split_group_history(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_current_split_group_history(text,text,date[],text[],bigint) TO service_role;
COMMENT ON TABLE public.current_split_group_history IS
  'Rebuildable event/book retained-history index produced by the sole existing collector and unchanged JS display trim. It may advance with new source receipts; all original observation versions remain immutable in current_split_observation_archive. No locked public records are stored or modified here.';
NOTIFY pgrst,'reload schema';
