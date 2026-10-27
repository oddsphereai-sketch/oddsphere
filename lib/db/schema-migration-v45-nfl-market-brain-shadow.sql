CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Short-lived, content-addressed parser inputs make normalization omissions
-- auditable without another provider request or duplicating raw rows per game.
CREATE TABLE IF NOT EXISTS public.nfl_market_brain_raw_parser_inputs (
  parser_input_sha256 char(64) PRIMARY KEY CHECK (parser_input_sha256 ~ '^[0-9a-f]{64}$'),
  schema_release text NOT NULL,
  parser_input jsonb NOT NULL,
  parser_input_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CHECK (parser_input_payload::jsonb = parser_input),
  CHECK (encode(digest(convert_to(parser_input_payload, 'UTF8'), 'sha256'), 'hex') = parser_input_sha256)
);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_raw_parser_input_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.expires_at := statement_timestamp() + interval '30 days';
  NEW.bytes := octet_length(NEW.parser_input_payload);
  IF NEW.bytes > 2097152 THEN
    RAISE EXCEPTION 'NFL Market Brain raw parser input exceeds 2 MiB';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:raw_parser_inputs', 0));
  IF EXISTS (SELECT 1 FROM public.nfl_market_brain_raw_parser_inputs
    WHERE parser_input_sha256 = NEW.parser_input_sha256) THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes FROM public.nfl_market_brain_raw_parser_inputs;
  IF existing_bytes + NEW.bytes > 268435456 THEN
    RAISE EXCEPTION 'NFL Market Brain raw parser-input 256 MiB global cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS nfl_market_brain_raw_parser_input_cap ON public.nfl_market_brain_raw_parser_inputs;
CREATE TRIGGER nfl_market_brain_raw_parser_input_cap BEFORE INSERT ON public.nfl_market_brain_raw_parser_inputs
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_raw_parser_input_cap();
ALTER TABLE public.nfl_market_brain_raw_parser_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_raw_parser_inputs FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.nfl_market_brain_raw_parser_inputs FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_raw_parser_inputs TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_raw_parser_input_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_raw_parser_input_cap() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_raw_parser_inputs IS
  'Thirty-day bounded exact provider rows handed to the research parser; content-addressed and never exposed to product readers.';

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
  capture_attempt_id uuid NOT NULL,
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
  UNIQUE (shadow_release, provider_game_id, capture_attempt_id),
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

ALTER TABLE public.nfl_market_brain_shadow_snapshots
  ADD COLUMN IF NOT EXISTS capture_attempt_id uuid;
ALTER TABLE public.nfl_market_brain_shadow_snapshots
  ALTER COLUMN capture_attempt_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nfl_market_brain_shadow_capture_attempt
  ON public.nfl_market_brain_shadow_snapshots (shadow_release, provider_game_id, capture_attempt_id);

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
       AND capture_attempt_id = NEW.capture_attempt_id
       AND shadow_sha256 <> NEW.shadow_sha256
  ) THEN
    RAISE EXCEPTION 'NFL Market Brain capture-attempt retry diverged from its immutable first result';
  END IF;
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
  WITH expired_raw AS (
    SELECT parser_input_sha256 FROM public.nfl_market_brain_raw_parser_inputs
     WHERE expires_at <= statement_timestamp()
     ORDER BY expires_at, parser_input_sha256
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.nfl_market_brain_raw_parser_inputs raw
   USING expired_raw WHERE raw.parser_input_sha256 = expired_raw.parser_input_sha256;
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

-- Finalizes the complete database membership of one predeclared event window.
-- Both successful tapes and capture_failed rows are required; after receipt,
-- an overlapping late insert is rejected so the set cannot be rewritten.
CREATE TABLE IF NOT EXISTS public.nfl_market_brain_capture_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_set_checksum char(64) NOT NULL UNIQUE CHECK (capture_set_checksum ~ '^[0-9a-f]{64}$'),
  event_id text NOT NULL,
  shadow_release text NOT NULL,
  contract_release text NOT NULL,
  manifest_checksum char(64) NOT NULL,
  partition_role text NOT NULL CHECK (partition_role IN ('development','selection','confirmation','prospective_shadow')),
  window_opens_at timestamptz NOT NULL,
  window_closes_at timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  capture_set jsonb NOT NULL,
  capture_set_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_opens_at <= window_closes_at AND window_closes_at <= cutoff_at AND cutoff_at < starts_at),
  CHECK ((capture_set ->> 'checksum') = capture_set_checksum),
  CHECK ((capture_set ->> 'eventId') = event_id),
  CHECK ((capture_set ->> 'shadowRelease') = shadow_release),
  CHECK ((capture_set ->> 'contractRelease') = contract_release),
  CHECK ((capture_set ->> 'manifestChecksum') = manifest_checksum),
  CHECK (capture_set_payload::jsonb = (capture_set - 'checksum')),
  CHECK (encode(digest(convert_to(capture_set_payload, 'UTF8'), 'sha256'), 'hex') = capture_set_checksum),
  CHECK (octet_length(capture_set_payload) <= 2097152),
  FOREIGN KEY (manifest_checksum)
    REFERENCES public.nfl_market_brain_research_manifests(manifest_checksum) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_capture_set_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  db_count integer;
  membership_count integer;
  expected_count integer;
  existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.bytes := octet_length(NEW.capture_set_payload);
  IF NEW.created_at < NEW.window_closes_at OR NEW.created_at >= NEW.starts_at THEN
    RAISE EXCEPTION 'NFL Market Brain capture set must be finalized after window close and before kickoff';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfl_market_brain:capture_set:' || NEW.event_id || ':' || NEW.window_opens_at || ':' || NEW.window_closes_at, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:capture_sets', 0));
  IF NOT EXISTS (
    SELECT 1
      FROM public.nfl_market_brain_research_manifests manifest,
           jsonb_array_elements(manifest.manifest -> 'partitions') partition,
           jsonb_array_elements(partition -> 'events') event
     WHERE manifest.manifest_checksum = NEW.manifest_checksum
       AND manifest.created_at < NEW.window_opens_at
       AND partition ->> 'role' = NEW.partition_role
       AND event ->> 'eventId' = NEW.event_id
       AND (event ->> 'captureWindowOpensAt')::timestamptz = NEW.window_opens_at
       AND (event ->> 'captureWindowClosesAt')::timestamptz = NEW.window_closes_at
       AND (event ->> 'cutoffAt')::timestamptz = NEW.cutoff_at
       AND (event ->> 'startsAt')::timestamptz = NEW.starts_at
       AND event -> 'expectedCaptureAttempts' = NEW.capture_set -> 'expectedCaptureAttempts'
  ) THEN
    RAISE EXCEPTION 'NFL Market Brain capture set diverges from its pre-window persisted manifest';
  END IF;
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes FROM public.nfl_market_brain_capture_sets;
  IF NEW.bytes > 2097152 OR existing_bytes + NEW.bytes > 67108864 THEN
    RAISE EXCEPTION 'NFL Market Brain capture-set storage cap exceeded';
  END IF;
  SELECT COUNT(*) INTO db_count FROM public.nfl_market_brain_shadow_snapshots s
   WHERE s.provider_game_id = NEW.event_id
     AND s.shadow_release = NEW.shadow_release
     AND s.contract_release = NEW.contract_release
     AND s.captured_at BETWEEN NEW.window_opens_at AND NEW.window_closes_at;
  membership_count := jsonb_array_length(NEW.capture_set -> 'membership');
  expected_count := jsonb_array_length(NEW.capture_set -> 'expectedCaptureAttempts');
  IF db_count <> membership_count OR membership_count <> expected_count OR membership_count < 1 THEN
    RAISE EXCEPTION 'NFL Market Brain capture set is not the complete predeclared database membership';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nfl_market_brain_shadow_snapshots s
     WHERE s.provider_game_id = NEW.event_id
       AND s.shadow_release = NEW.shadow_release
       AND s.contract_release = NEW.contract_release
       AND s.captured_at BETWEEN NEW.window_opens_at AND NEW.window_closes_at
       AND s.created_at NOT BETWEEN NEW.window_opens_at AND NEW.window_closes_at
  ) OR EXISTS (
    SELECT 1 FROM public.nfl_market_brain_shadow_snapshots s
     WHERE s.provider_game_id = NEW.event_id
       AND s.shadow_release = NEW.shadow_release
       AND s.contract_release = NEW.contract_release
       AND s.captured_at BETWEEN NEW.window_opens_at AND NEW.window_closes_at
       AND s.created_at BETWEEN NEW.window_opens_at AND NEW.window_closes_at
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.capture_set -> 'membership') m
         WHERE m ->> 'recordId' = s.id::text AND m ->> 'runId' = s.capture_attempt_id::text
           AND m ->> 'stage' = s.stage AND m ->> 'shadowSha256' = s.shadow_sha256
           AND (m ->> 'capturedAt')::timestamptz = s.captured_at
           AND (m ->> 'serverCreatedAt')::timestamptz = s.created_at
           AND m ->> 'status' = CASE WHEN s.shadow ? 'case' THEN 'captured' ELSE 'capture_failed' END)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.capture_set -> 'expectedCaptureAttempts') e
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.capture_set -> 'membership') m
       WHERE m ->> 'runId' = e ->> 'runId' AND m ->> 'stage' = e ->> 'stage')
  ) THEN
    RAISE EXCEPTION 'NFL Market Brain capture set membership or expected attempts differ from stored rows';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_nfl_market_brain_late_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.nfl_market_brain_capture_sets c
    WHERE c.event_id = NEW.provider_game_id
      AND c.shadow_release = NEW.shadow_release
      AND c.contract_release = NEW.contract_release
      AND NEW.captured_at BETWEEN c.window_opens_at AND c.window_closes_at) THEN
    RAISE EXCEPTION 'NFL Market Brain capture window has already been finalized';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfl_market_brain_capture_set_receipt ON public.nfl_market_brain_capture_sets;
CREATE TRIGGER nfl_market_brain_capture_set_receipt
BEFORE INSERT ON public.nfl_market_brain_capture_sets
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_capture_set_receipt();
DROP TRIGGER IF EXISTS nfl_market_brain_reject_late_capture ON public.nfl_market_brain_shadow_snapshots;
CREATE TRIGGER nfl_market_brain_reject_late_capture
BEFORE INSERT ON public.nfl_market_brain_shadow_snapshots
FOR EACH ROW EXECUTE FUNCTION public.reject_nfl_market_brain_late_capture();

ALTER TABLE public.nfl_market_brain_capture_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_capture_sets FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.nfl_market_brain_capture_sets FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_capture_sets TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_capture_set_receipt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_nfl_market_brain_late_capture() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_capture_set_receipt() TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_nfl_market_brain_late_capture() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_capture_sets IS
  'Append-only server-verified complete success/failure membership for a predeclared NFL Market Brain capture window.';

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_research_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_input_checksum char(64) NOT NULL UNIQUE CHECK (research_input_checksum ~ '^[0-9a-f]{64}$'),
  event_id text NOT NULL,
  cutoff_at timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  manifest_checksum char(64) NOT NULL,
  capture_set_id uuid NOT NULL,
  capture_set_checksum char(64) NOT NULL,
  sequence_checksum char(64) NOT NULL,
  feature_checksum char(64) NOT NULL,
  research_input jsonb NOT NULL,
  research_input_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 16777216),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cutoff_at < starts_at),
  CHECK ((research_input ->> 'checksum') = research_input_checksum),
  CHECK ((research_input ->> 'eventId') = event_id),
  CHECK ((research_input ->> 'captureSetChecksum') = capture_set_checksum),
  CHECK ((research_input ->> 'sequenceChecksum') = sequence_checksum),
  CHECK ((research_input ->> 'featureChecksum') = feature_checksum),
  CHECK (research_input_payload::jsonb = (research_input - 'checksum')),
  CHECK (encode(digest(convert_to(research_input_payload, 'UTF8'), 'sha256'), 'hex') = research_input_checksum),
  FOREIGN KEY (manifest_checksum) REFERENCES public.nfl_market_brain_research_manifests(manifest_checksum) ON DELETE RESTRICT,
  FOREIGN KEY (capture_set_id) REFERENCES public.nfl_market_brain_capture_sets(id) ON DELETE RESTRICT,
  FOREIGN KEY (capture_set_checksum) REFERENCES public.nfl_market_brain_capture_sets(capture_set_checksum) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_research_input_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.bytes := octet_length(NEW.research_input_payload);
  IF NEW.bytes > 16777216 OR NEW.created_at >= NEW.starts_at THEN
    RAISE EXCEPTION 'NFL Market Brain durable research input exceeds its cap or arrived after kickoff';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.nfl_market_brain_capture_sets capture_set
     WHERE capture_set.id = NEW.capture_set_id
       AND capture_set.capture_set_checksum = NEW.capture_set_checksum
       AND capture_set.event_id = NEW.event_id
       AND capture_set.manifest_checksum = NEW.manifest_checksum
       AND capture_set.cutoff_at = NEW.cutoff_at
       AND capture_set.starts_at = NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'NFL Market Brain research input is not bound to one exact finalized capture set';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:research_inputs', 0));
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes FROM public.nfl_market_brain_research_inputs;
  IF existing_bytes + NEW.bytes > 2147483648 THEN
    RAISE EXCEPTION 'NFL Market Brain research-input global 2 GiB cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS nfl_market_brain_research_input_receipt ON public.nfl_market_brain_research_inputs;
CREATE TRIGGER nfl_market_brain_research_input_receipt BEFORE INSERT ON public.nfl_market_brain_research_inputs
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_research_input_receipt();
ALTER TABLE public.nfl_market_brain_research_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_research_inputs FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.nfl_market_brain_research_inputs FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_research_inputs TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_research_input_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_research_input_receipt() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_research_inputs IS
  'Durable append-only exact sequences and feature vectors bound to finalized capture sets before inference.';

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
  research_input_id uuid NOT NULL,
  research_input_checksum char(64) NOT NULL CHECK (research_input_checksum ~ '^[0-9a-f]{64}$'),
  capture_set_checksum char(64) NOT NULL CHECK (capture_set_checksum ~ '^[0-9a-f]{64}$'),
  resolver_output_checksum char(64) NOT NULL CHECK (resolver_output_checksum ~ '^[0-9a-f]{64}$'),
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
  CONSTRAINT nfl_market_brain_prediction_provenance_shape CHECK (
    (prediction ->> 'researchInputRecordId') = research_input_id::text AND
    (prediction ->> 'researchInputChecksum') = research_input_checksum AND
    (prediction ->> 'captureSetChecksum') = capture_set_checksum AND
    (prediction ->> 'resolverOutputChecksum') = resolver_output_checksum
  ),
  CHECK ((prediction ->> 'sequenceChecksum') = sequence_checksum),
  CHECK ((prediction ->> 'featureChecksum') = feature_checksum),
  CHECK (prediction_payload::jsonb = prediction),
  CHECK (encode(digest(convert_to(prediction_payload, 'UTF8'), 'sha256'), 'hex') = prediction_sha256),
  FOREIGN KEY (artifact_sha256)
    REFERENCES public.nfl_market_brain_resolver_artifacts(artifact_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (training_manifest_checksum)
    REFERENCES public.nfl_market_brain_research_manifests(manifest_checksum) ON DELETE RESTRICT,
  CONSTRAINT nfl_market_brain_prediction_research_input_fk FOREIGN KEY (research_input_id)
    REFERENCES public.nfl_market_brain_research_inputs(id) ON DELETE RESTRICT,
  CONSTRAINT nfl_market_brain_prediction_research_input_checksum_fk FOREIGN KEY (research_input_checksum)
    REFERENCES public.nfl_market_brain_research_inputs(research_input_checksum) ON DELETE RESTRICT,
  CONSTRAINT nfl_market_brain_prediction_capture_set_fk FOREIGN KEY (capture_set_checksum)
    REFERENCES public.nfl_market_brain_capture_sets(capture_set_checksum) ON DELETE RESTRICT
);

-- Upgrade an already-created shadow-only v45 table in place. The production
-- inventory was empty when this remediation was prepared; any incompatible
-- pre-existing row makes SET NOT NULL fail closed rather than being invented.
ALTER TABLE public.nfl_market_brain_research_predictions
  ADD COLUMN IF NOT EXISTS research_input_id uuid,
  ADD COLUMN IF NOT EXISTS research_input_checksum char(64),
  ADD COLUMN IF NOT EXISTS capture_set_checksum char(64),
  ADD COLUMN IF NOT EXISTS resolver_output_checksum char(64);
ALTER TABLE public.nfl_market_brain_research_predictions
  ALTER COLUMN research_input_id SET NOT NULL,
  ALTER COLUMN research_input_checksum SET NOT NULL,
  ALTER COLUMN capture_set_checksum SET NOT NULL,
  ALTER COLUMN resolver_output_checksum SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nfl_market_brain_prediction_research_input_fk') THEN
    ALTER TABLE public.nfl_market_brain_research_predictions
      ADD CONSTRAINT nfl_market_brain_prediction_research_input_fk
      FOREIGN KEY (research_input_id) REFERENCES public.nfl_market_brain_research_inputs(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nfl_market_brain_prediction_research_input_checksum_fk') THEN
    ALTER TABLE public.nfl_market_brain_research_predictions
      ADD CONSTRAINT nfl_market_brain_prediction_research_input_checksum_fk
      FOREIGN KEY (research_input_checksum) REFERENCES public.nfl_market_brain_research_inputs(research_input_checksum)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nfl_market_brain_prediction_capture_set_fk') THEN
    ALTER TABLE public.nfl_market_brain_research_predictions
      ADD CONSTRAINT nfl_market_brain_prediction_capture_set_fk
      FOREIGN KEY (capture_set_checksum) REFERENCES public.nfl_market_brain_capture_sets(capture_set_checksum)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nfl_market_brain_prediction_provenance_shape') THEN
    ALTER TABLE public.nfl_market_brain_research_predictions
      ADD CONSTRAINT nfl_market_brain_prediction_provenance_shape CHECK (
        research_input_checksum ~ '^[0-9a-f]{64}$' AND capture_set_checksum ~ '^[0-9a-f]{64}$' AND
        resolver_output_checksum ~ '^[0-9a-f]{64}$' AND
        (prediction ->> 'researchInputRecordId') = research_input_id::text AND
        (prediction ->> 'researchInputChecksum') = research_input_checksum AND
        (prediction ->> 'captureSetChecksum') = capture_set_checksum AND
        (prediction ->> 'resolverOutputChecksum') = resolver_output_checksum
      );
  END IF;
END;
$$;

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
  IF NOT EXISTS (
    SELECT 1
      FROM public.nfl_market_brain_research_inputs research_input
      JOIN public.nfl_market_brain_resolver_artifacts artifact
        ON artifact.artifact_sha256 = NEW.artifact_sha256
     WHERE research_input.id = NEW.research_input_id
       AND research_input.research_input_checksum = NEW.research_input_checksum
       AND research_input.event_id = NEW.event_id
       AND research_input.cutoff_at = NEW.cutoff_at
       AND research_input.starts_at = NEW.starts_at
       AND research_input.manifest_checksum = NEW.training_manifest_checksum
       AND research_input.capture_set_checksum = NEW.capture_set_checksum
       AND research_input.sequence_checksum = NEW.sequence_checksum
       AND research_input.feature_checksum = NEW.feature_checksum
       AND artifact.training_manifest_checksum = NEW.training_manifest_checksum
  ) THEN
    RAISE EXCEPTION 'NFL Market Brain prediction provenance does not resolve to one exact input and artifact';
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

CREATE TABLE IF NOT EXISTS public.nfl_market_brain_research_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_checksum char(64) NOT NULL UNIQUE CHECK (outcome_checksum ~ '^[0-9a-f]{64}$'),
  event_id text NOT NULL,
  game_id bigint NOT NULL,
  source_row_sha256 char(64) NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  final_at timestamptz NOT NULL,
  outcome jsonb NOT NULL,
  outcome_payload text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome ->> 'checksum') = outcome_checksum),
  CHECK ((outcome ->> 'eventId') = event_id),
  CHECK ((outcome #>> '{source,gameRecordId}') = game_id::text),
  CHECK ((outcome #>> '{source,sourceRowSha256}') = source_row_sha256),
  CHECK (outcome_payload::jsonb = (outcome - 'checksum')),
  CHECK (encode(digest(convert_to(outcome_payload, 'UTF8'), 'sha256'), 'hex') = outcome_checksum),
  FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enforce_nfl_market_brain_outcome_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  verified record;
  existing_bytes bigint;
BEGIN
  NEW.created_at := statement_timestamp();
  NEW.bytes := octet_length(NEW.outcome_payload);
  SELECT id, external_id, status, away_score, home_score, provider_ids, updated_at INTO verified
    FROM public.games WHERE id = NEW.game_id FOR SHARE;
  IF verified.id IS NULL OR verified.external_id <> NEW.event_id OR verified.status <> 'final' OR
     verified.away_score IS NULL OR verified.home_score IS NULL OR NEW.created_at < NEW.final_at THEN
    RAISE EXCEPTION 'NFL Market Brain outcome is not backed by an exact finalized games row';
  END IF;
  IF (NEW.outcome ->> 'awayScore')::integer <> verified.away_score OR
     (NEW.outcome ->> 'homeScore')::integer <> verified.home_score OR
     NEW.outcome #> '{source,providerIds}' IS DISTINCT FROM to_jsonb(verified.provider_ids) OR
     (NEW.outcome #>> '{source,sourceUpdatedAt}')::timestamptz <> verified.updated_at THEN
    RAISE EXCEPTION 'NFL Market Brain outcome payload diverges from its finalized games row';
  END IF;
  IF NEW.bytes > 65536 THEN RAISE EXCEPTION 'NFL Market Brain outcome exceeds 64 KiB'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nfl_market_brain:research_outcomes', 0));
  SELECT COALESCE(SUM(bytes), 0) INTO existing_bytes FROM public.nfl_market_brain_research_outcomes;
  IF existing_bytes + NEW.bytes > 67108864 THEN
    RAISE EXCEPTION 'NFL Market Brain outcome global 64 MiB cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS nfl_market_brain_outcome_receipt ON public.nfl_market_brain_research_outcomes;
CREATE TRIGGER nfl_market_brain_outcome_receipt BEFORE INSERT ON public.nfl_market_brain_research_outcomes
FOR EACH ROW EXECUTE FUNCTION public.enforce_nfl_market_brain_outcome_receipt();
ALTER TABLE public.nfl_market_brain_research_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfl_market_brain_research_outcomes FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.nfl_market_brain_research_outcomes FROM service_role;
GRANT SELECT, INSERT ON TABLE public.nfl_market_brain_research_outcomes TO service_role;
REVOKE ALL ON FUNCTION public.enforce_nfl_market_brain_outcome_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_nfl_market_brain_outcome_receipt() TO service_role;

COMMENT ON TABLE public.nfl_market_brain_research_outcomes IS
  'Append-only verified NFL final-score receipts sourced from exact finalized games rows; never caller-provided labels.';
