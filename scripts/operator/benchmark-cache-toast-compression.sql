-- Bounded disposable benchmark. Only pg_temp receives writes; everything is
-- rolled back. Use the captured JSON text to force recompression as a real
-- incoming API write would, rather than preserving an existing TOAST pointer.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE cache_bench_input (key text, payload_text text) ON COMMIT DROP;
ALTER TABLE cache_bench_input ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_bench_input ALTER COLUMN payload_text SET STORAGE EXTERNAL;
INSERT INTO cache_bench_input SELECT snapshot_key,payload::text
FROM public.lab_response_snapshots WHERE snapshot_key IN
  ('nba::player-props-private-market::2026-11-02','cbb::2026-11-02::current-only::live-copy');
CREATE TEMP TABLE cache_bench_pglz (id bigserial,key text,payload jsonb COMPRESSION pglz) ON COMMIT DROP;
CREATE TEMP TABLE cache_bench_lz4 (id bigserial,key text,payload jsonb COMPRESSION lz4) ON COMMIT DROP;
CREATE TEMP TABLE cache_bench_result (key text,algorithm text,round int,ms numeric,stored_bytes bigint,actual_compression text,identical boolean) ON COMMIT DROP;
ALTER TABLE cache_bench_pglz ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_bench_lz4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_bench_result ENABLE ROW LEVEL SECURITY;
DO $bench$
DECLARE k text; algo text; r int; plan json;
BEGIN
  FOR k IN SELECT key FROM cache_bench_input LOOP
    FOR r IN 1..3 LOOP
      FOREACH algo IN ARRAY CASE WHEN r=2 THEN ARRAY['lz4','pglz'] ELSE ARRAY['pglz','lz4'] END LOOP
        EXECUTE format('EXPLAIN (ANALYZE,FORMAT JSON) INSERT INTO pg_temp.cache_bench_%s(key,payload) SELECT key,payload_text::jsonb FROM pg_temp.cache_bench_input WHERE key=%L',algo,k) INTO plan;
        EXECUTE format('INSERT INTO pg_temp.cache_bench_result SELECT key,%L,%s,%s,pg_column_size(payload),pg_column_compression(payload),payload=(SELECT payload_text::jsonb FROM pg_temp.cache_bench_input WHERE key=%L) FROM pg_temp.cache_bench_%s ORDER BY id DESC LIMIT 1',algo,r,(plan->0->>'Execution Time')::numeric,k,algo);
      END LOOP;
    END LOOP;
  END LOOP;
END $bench$;
SELECT key,algorithm,count(*) AS trials,round(avg(ms),3) AS mean_ms,
  max(stored_bytes) AS stored_bytes,max(actual_compression) AS actual_compression,
  bool_and(identical) AS identical
FROM cache_bench_result GROUP BY key,algorithm ORDER BY key,algorithm;
ROLLBACK;
