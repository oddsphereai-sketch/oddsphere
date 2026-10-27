CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Exact priors are retained independently so a compact reference can never
-- outlive the immutable bytes it names.
CREATE TABLE IF NOT EXISTS public.nfl_market_brain_prior_artifacts (
  artifact_sha256 char(64) PRIMARY KEY CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  shadow_release text NOT NULL,
  contract_release text NOT NULL,
  provider_game_id text NOT NULL,
  prior_artifact jsonb NOT NULL,
  artifact_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '600 days'),
  CHECK ((prior_artifact ->> 'sha256') = artifact_sha256),
  CHECK (artifact_payload::jsonb = (prior_artifact - 'sha256')),
  CHECK (encode(digest(convert_to(artifact_payload, 'UTF8'), 'sha256'), 'hex') = artifact_sha256),
  CHECK (octet_length(prior_artifact::text) <= 1048576)
);

-- Research-only Market Brain tapes are isolated from the authoritative NFL
-- forward-evidence row so their size or persistence can never block a model,
-- member snapshot, tracking record, or immutable lock write.
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
  shadow_payload text NOT NULL,
  prior_artifact_sha256 char(64) CHECK (
    prior_artifact_sha256 IS NULL OR prior_artifact_sha256 ~ '^[0-9a-f]{64}$'
  ),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 98304),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '210 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shadow_release, provider_game_id, stage, captured_at, shadow_sha256),
  FOREIGN KEY (prior_artifact_sha256)
    REFERENCES public.nfl_market_brain_prior_artifacts(artifact_sha256)
    ON DELETE RESTRICT,
  CHECK (shadow_payload::jsonb = shadow),
  CHECK (encode(digest(convert_to(shadow_payload, 'UTF8'), 'sha256'), 'hex') = shadow_sha256),
  CHECK (prior_artifact_sha256 IS NOT DISTINCT FROM CASE
    WHEN shadow #>> '{case,prior,kind}' = 'margin_total_distribution'
      THEN shadow #>> '{case,prior,artifact,sha256}'
    WHEN shadow #>> '{case,prior,kind}' = 'margin_total_distribution_ref'
      THEN shadow #>> '{case,prior,artifactSha256}'
    ELSE NULL END)
);

CREATE INDEX IF NOT EXISTS nfl_market_brain_shadow_week_captured
  ON public.nfl_market_brain_shadow_snapshots (season, week, captured_at, provider_game_id);
CREATE INDEX IF NOT EXISTS nfl_market_brain_shadow_prior_artifact
  ON public.nfl_market_brain_shadow_snapshots
    (season, week, shadow_release, contract_release, provider_game_id, prior_artifact_sha256)
  WHERE prior_artifact_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS nfl_market_brain_shadow_expiry
  ON public.nfl_market_brain_shadow_snapshots (expires_at, id);
CREATE INDEX IF NOT EXISTS nfl_market_brain_prior_artifact_expiry
  ON public.nfl_market_brain_prior_artifacts (expires_at, artifact_sha256);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_artifact_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.expires_at := statement_timestamp() + interval '600 days';
  NEW.bytes := octet_length(NEW.artifact_payload);
  IF NEW.bytes > 1048576 THEN
    RAISE EXCEPTION 'NFL Market Brain prior artifact exceeds the 1 MiB stored payload limit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:prior_artifacts', 0));
  IF EXISTS (SELECT 1 FROM public.nfl_market_brain_prior_artifacts
    WHERE artifact_sha256 = NEW.artifact_sha256) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes
    FROM public.nfl_market_brain_prior_artifacts;
  IF existing_bytes + NEW.bytes > 2147483648 THEN
    RAISE EXCEPTION 'NFL Market Brain prior-artifact global 2 GiB cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_artifact_cap ON public.nfl_market_brain_prior_artifacts;
CREATE TRIGGER nfl_market_brain_artifact_cap
BEFORE INSERT ON public.nfl_market_brain_prior_artifacts
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_artifact_cap();

-- Serialize each season/week's research inserts and fail closed before the
-- conservative 256 MiB raw weekly envelope is exceeded. This is a storage
-- safety boundary, never permission for a prediction or reader change.
CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bytes bigint;
BEGIN
  -- Never trust caller-owned storage accounting or retention timestamps.
  NEW.created_at := statement_timestamp();
  NEW.expires_at := statement_timestamp() + interval '210 days';
  NEW.bytes := octet_length(NEW.shadow_payload);
  IF NEW.bytes > 98304 THEN
    RAISE EXCEPTION 'NFL Market Brain tape exceeds the 96 KiB stored JSON limit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:' || NEW.season || ':' || NEW.week, 0));
  IF EXISTS (
    SELECT 1 FROM public.nfl_market_brain_shadow_snapshots
     WHERE shadow_release = NEW.shadow_release
       AND provider_game_id = NEW.provider_game_id
       AND stage = NEW.stage
       AND captured_at = NEW.captured_at
       AND shadow_sha256 = NEW.shadow_sha256
  ) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(bytes), 0)
    INTO existing_bytes
    FROM public.nfl_market_brain_shadow_snapshots
   WHERE season = NEW.season AND week = NEW.week;
  IF existing_bytes + NEW.bytes > 268435456 THEN
    RAISE EXCEPTION 'NFL Market Brain weekly raw-byte cap exceeded for season %, week %', NEW.season, NEW.week;
  END IF;
  SELECT COALESCE(SUM(bytes), 0)
    INTO existing_bytes
    FROM public.nfl_market_brain_shadow_snapshots
   WHERE season = NEW.season;
  IF existing_bytes + NEW.bytes > 5368709120 THEN
    RAISE EXCEPTION 'NFL Market Brain season raw-byte cap exceeded for season %', NEW.season;
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
ALTER TABLE public.nfl_market_brain_prior_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_shadow_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.nfl_market_brain_prior_artifacts FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_shadow_snapshots FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_prior_artifacts FROM service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_artifact_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_weekly_byte_cap() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_artifact_cap() TO service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_shadow_snapshots TO service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_prior_artifacts TO service_role;

COMMENT ON TABLE public.nfl_market_brain_shadow_snapshots IS
  'Append-only, bounded, research-only NFL Market Brain tapes with no prediction, grade, member, tracking, or lock authority.';

COMMENT ON TABLE public.nfl_market_brain_prior_artifacts IS
  'Immutable content-addressed NFL prior artifacts retained beyond every research shadow reference.';

CREATE OR REPLACE FUNCTION public.purge_expired_nfl_market_brain_research(p_limit integer DEFAULT 5000)
RETURNS TABLE(shadows_deleted integer, artifacts_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_shadows integer;
  deleted_artifacts integer;
BEGIN
  IF p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'NFL Market Brain purge limit must be between 1 and 10000';
  END IF;
  WITH expired AS (
    SELECT id FROM public.nfl_market_brain_shadow_snapshots
     WHERE expires_at <= statement_timestamp()
     ORDER BY expires_at, id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.nfl_market_brain_shadow_snapshots row
   USING expired WHERE row.id = expired.id;
  GET DIAGNOSTICS deleted_shadows = ROW_COUNT;

  WITH expired AS (
    SELECT artifact.artifact_sha256
      FROM public.nfl_market_brain_prior_artifacts artifact
     WHERE artifact.expires_at <= statement_timestamp()
       AND NOT EXISTS (
         SELECT 1 FROM public.nfl_market_brain_shadow_snapshots shadow
          WHERE shadow.prior_artifact_sha256 = artifact.artifact_sha256
       )
     ORDER BY artifact.expires_at, artifact.artifact_sha256
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.nfl_market_brain_prior_artifacts artifact
   USING expired WHERE artifact.artifact_sha256 = expired.artifact_sha256;
  GET DIAGNOSTICS deleted_artifacts = ROW_COUNT;
  RETURN QUERY SELECT deleted_shadows, deleted_artifacts;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_nfl_market_brain_research(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_nfl_market_brain_research(integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_research_manifests (
  id text PRIMARY KEY,
  manifest_release text NOT NULL,
  candidate_release text NOT NULL,
  manifest_checksum char(64) NOT NULL UNIQUE CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL,
  manifest_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((manifest ->> 'storageId') = id),
  CHECK ((manifest ->> 'checksum') = manifest_checksum),
  CHECK ((manifest ->> 'candidateRelease') = candidate_release),
  CHECK ((manifest ->> 'release') = manifest_release),
  CHECK (manifest_payload::jsonb = (manifest - 'checksum')),
  CHECK (encode(digest(convert_to(manifest_payload, 'UTF8'), 'sha256'), 'hex') = manifest_checksum),
  CHECK (created_at >= (manifest ->> 'createdAt')::timestamptz),
  CHECK (octet_length(manifest::text) <= 2097152)
);

CREATE OR REPLACE FUNCTION public.force_nfl_market_brain_manifest_receipt_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_at := statement_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_manifest_server_receipt
  ON public.nfl_market_brain_research_manifests;
CREATE TRIGGER nfl_market_brain_manifest_server_receipt
BEFORE INSERT ON public.nfl_market_brain_research_manifests
FOR EACH ROW EXECUTE FUNCTION public.force_nfl_market_brain_manifest_receipt_time();

ALTER TABLE public.nfl_market_brain_research_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_research_manifests FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_research_manifests FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_research_manifests TO service_role;
REVOKE ALL ON FUNCTION public.force_nfl_market_brain_manifest_receipt_time()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_nfl_market_brain_manifest_receipt_time() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_research_manifests IS
  'Append-only precommit records for NFL Market Brain chronological partitions and opened-outcome registries.';

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_resolver_artifacts (
  artifact_sha256 char(64) PRIMARY KEY CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  weights_sha256 char(64) NOT NULL UNIQUE CHECK (weights_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_release text NOT NULL,
  training_manifest_checksum char(64) NOT NULL CHECK (training_manifest_checksum ~ '^[0-9a-f]{64}$'),
  artifact jsonb NOT NULL,
  weights jsonb NOT NULL,
  artifact_payload text NOT NULL,
  weights_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 524288),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((artifact ->> 'sha256') = artifact_sha256),
  CHECK ((artifact ->> 'weightsSha256') = weights_sha256),
  CHECK ((artifact ->> 'release') = artifact_release),
  CHECK ((artifact ->> 'trainingManifestChecksum') = training_manifest_checksum),
  CHECK (artifact_payload::jsonb = (artifact - 'sha256')),
  CHECK (weights_payload::jsonb = weights),
  CHECK (encode(digest(convert_to(artifact_payload, 'UTF8'), 'sha256'), 'hex') = artifact_sha256),
  CHECK (encode(digest(convert_to(weights_payload, 'UTF8'), 'sha256'), 'hex') = weights_sha256),
  FOREIGN KEY (training_manifest_checksum)
    REFERENCES public.nfl_market_brain_research_manifests(manifest_checksum)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_resolver_artifact_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.bytes := octet_length(NEW.artifact_payload) + octet_length(NEW.weights_payload);
  IF NEW.bytes > 524288 THEN
    RAISE EXCEPTION 'NFL Market Brain resolver artifact exceeds the 512 KiB byte limit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:resolver_artifacts', 0));
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes
    FROM public.nfl_market_brain_resolver_artifacts;
  IF existing_bytes + NEW.bytes > 67108864 THEN
    RAISE EXCEPTION 'NFL Market Brain resolver-artifact global 64 MiB cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_resolver_artifact_receipt
  ON public.nfl_market_brain_resolver_artifacts;
CREATE TRIGGER nfl_market_brain_resolver_artifact_receipt
BEFORE INSERT ON public.nfl_market_brain_resolver_artifacts
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_resolver_artifact_receipt();

ALTER TABLE public.nfl_market_brain_resolver_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_resolver_artifacts FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_resolver_artifacts FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_resolver_artifacts TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_resolver_artifact_receipt()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_resolver_artifact_receipt() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_resolver_artifacts IS
  'Append-only exact trainer artifacts and coefficient bytes; database receipt must predate every scored cutoff.';

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_research_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_sha256 char(64) NOT NULL UNIQUE CHECK (prediction_sha256 ~ '^[0-9a-f]{64}$'),
  event_id text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  candidate_release text NOT NULL,
  artifact_sha256 char(64) NOT NULL,
  training_manifest_checksum char(64) NOT NULL,
  sequence_checksum char(64) NOT NULL CHECK (sequence_checksum ~ '^[0-9a-f]{64}$'),
  feature_checksum char(64) NOT NULL CHECK (feature_checksum ~ '^[0-9a-f]{64}$'),
  prediction jsonb NOT NULL,
  prediction_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 8388608),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, sequence_checksum, artifact_sha256),
  CHECK (cutoff_at < starts_at),
  CHECK ((prediction ->> 'eventId') = event_id),
  CHECK ((prediction ->> 'cutoffAt')::timestamptz = cutoff_at),
  CHECK ((prediction ->> 'startsAt')::timestamptz = starts_at),
  CHECK ((prediction ->> 'release') = candidate_release),
  CHECK ((prediction ->> 'artifactSha256') = artifact_sha256),
  CHECK ((prediction ->> 'trainingManifestChecksum') = training_manifest_checksum),
  CHECK ((prediction ->> 'sequenceChecksum') = sequence_checksum),
  CHECK ((prediction ->> 'featureChecksum') = feature_checksum),
  CHECK (prediction_payload::jsonb = prediction),
  CHECK (encode(digest(convert_to(prediction_payload, 'UTF8'), 'sha256'), 'hex') = prediction_sha256),
  FOREIGN KEY (artifact_sha256)
    REFERENCES public.nfl_market_brain_resolver_artifacts(artifact_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (training_manifest_checksum)
    REFERENCES public.nfl_market_brain_research_manifests(manifest_checksum) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS nfl_market_brain_research_prediction_event
  ON public.nfl_market_brain_research_predictions (event_id, cutoff_at, created_at);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_prediction_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.bytes := octet_length(NEW.prediction_payload);
  IF NEW.bytes > 8388608 THEN
    RAISE EXCEPTION 'NFL Market Brain research prediction exceeds the 8 MiB byte limit';
  END IF;
  IF NEW.created_at < (NEW.prediction ->> 'inferredAt')::timestamptz OR
     NEW.created_at >= NEW.starts_at THEN
    RAISE EXCEPTION 'NFL Market Brain research prediction was not received pregame after inference';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:research_predictions', 0));
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes
    FROM public.nfl_market_brain_research_predictions;
  IF existing_bytes + NEW.bytes > 2147483648 THEN
    RAISE EXCEPTION 'NFL Market Brain research-prediction global 2 GiB cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_prediction_receipt
  ON public.nfl_market_brain_research_predictions;
CREATE TRIGGER nfl_market_brain_prediction_receipt
BEFORE INSERT ON public.nfl_market_brain_research_predictions
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_prediction_receipt();

ALTER TABLE public.nfl_market_brain_research_predictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_research_predictions FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.nfl_market_brain_research_predictions FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_research_predictions TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_prediction_receipt()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_prediction_receipt() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_research_predictions IS
  'Append-only canonical pregame Market Brain predictions bound to exact sequences, features, artifacts, and manifests.';
