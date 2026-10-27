-- Exact v45 shape first published by b0cd9ae4. This fixture is intentionally
-- frozen so the forward migration is tested against the schema operators may
-- already have installed, not the later-edited source file.
CREATE TABLE IF NOT EXISTS public.nfl_market_brain_shadow_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_release text NOT NULL,
  contract_release text NOT NULL,
  run_id uuid NOT NULL,
  season integer NOT NULL CHECK (season >= 2026),
  week integer NOT NULL CHECK (week BETWEEN 1 AND 18),
  provider_game_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('opening', 'unlocked', 't60')),
  captured_at timestamptz NOT NULL,
  shadow jsonb NOT NULL,
  shadow_sha256 char(64) NOT NULL CHECK (shadow_sha256 ~ '^[0-9a-f]{64}$'),
  prior_artifact_sha256 char(64) CHECK (
    prior_artifact_sha256 IS NULL OR prior_artifact_sha256 ~ '^[0-9a-f]{64}$'
  ),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 98304),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '210 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shadow_release, provider_game_id, stage, captured_at, shadow_sha256)
);

CREATE INDEX IF NOT EXISTS nfl_market_brain_shadow_week_captured
  ON public.nfl_market_brain_shadow_snapshots (season, week, captured_at, provider_game_id);
CREATE INDEX IF NOT EXISTS nfl_market_brain_shadow_prior_artifact
  ON public.nfl_market_brain_shadow_snapshots
    (season, week, shadow_release, contract_release, provider_game_id, prior_artifact_sha256)
  WHERE prior_artifact_sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bytes bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:' || NEW.season || ':' || NEW.week, 0));
  SELECT COALESCE(SUM(bytes), 0)
    INTO existing_bytes
    FROM public.nfl_market_brain_shadow_snapshots
   WHERE season = NEW.season AND week = NEW.week;
  IF existing_bytes + NEW.bytes > 268435456 THEN
    RAISE EXCEPTION 'NFL Market Brain weekly raw-byte cap exceeded for season %, week %', NEW.season, NEW.week;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_weekly_byte_cap
  ON public.nfl_market_brain_shadow_snapshots;
CREATE TRIGGER nfl_market_brain_weekly_byte_cap
BEFORE INSERT ON public.nfl_market_brain_shadow_snapshots
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap();

ALTER TABLE public.nfl_market_brain_shadow_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_shadow_snapshots FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_shadow_snapshots FROM service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap() TO service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_shadow_snapshots TO service_role;

COMMENT ON TABLE public.nfl_market_brain_shadow_snapshots IS
  'Append-only, bounded, research-only NFL Market Brain tapes with no prediction, grade, member, tracking, or lock authority.';

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_research_manifests (
  id text PRIMARY KEY,
  manifest_release text NOT NULL,
  candidate_release text NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  manifest_checksum char(64) NOT NULL UNIQUE CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((manifest ->> 'storageId') = id),
  CHECK ((manifest ->> 'checksum') = manifest_checksum),
  CHECK ((manifest ->> 'candidateRelease') = candidate_release),
  CHECK ((manifest ->> 'release') = manifest_release),
  CHECK ((manifest ->> 'persistedAt')::timestamptz = persisted_at),
  CHECK (created_at >= (manifest ->> 'createdAt')::timestamptz),
  CHECK (octet_length(manifest::text) <= 2097152)
);

ALTER TABLE public.nfl_market_brain_research_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_research_manifests FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_research_manifests FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_research_manifests TO service_role;

COMMENT ON TABLE public.nfl_market_brain_research_manifests IS
  'Append-only precommit records for NFL Market Brain chronological partitions and opened-outcome registries.';
