-- Native lossless physical compression for FUTURE cache writes only.
-- Existing TOAST values are not rewritten. All JSON, timestamps, keys, TTLs,
-- source/version fields and writers retain their existing behavior.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $guard$
BEGIN
  IF (SELECT attstorage FROM pg_attribute
      WHERE attrelid='public.lab_response_snapshots'::regclass AND attname='payload') <> 'x' THEN
    RAISE EXCEPTION 'Expected EXTENDED payload storage; review the existing configuration before changing compression';
  END IF;
END $guard$;
ALTER TABLE public.lab_response_snapshots ALTER COLUMN payload SET COMPRESSION lz4;
COMMIT;
