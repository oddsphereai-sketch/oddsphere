-- Executed only against the disposable real-PostgreSQL proof database. The
-- prerequisite rows are backdated under replica mode; both research-input
-- attempts execute the actual v46 and v50 receipt triggers.
DO $decision_envelope_proof$
DECLARE
  ids record;
  manifest_payload text;
  manifest_sha text;
  manifest_doc jsonb;
  shadow_payload text;
  shadow_sha text;
  shadow_doc jsonb;
  capture_payload text;
  capture_sha text;
  capture_doc jsonb;
  input_payload text;
  input_sha text;
  input_doc jsonb;
  forged_payload text;
  forged_sha text;
  forged_doc jsonb;
  base_time timestamptz;
  rejected boolean := false;
BEGIN
  SELECT * INTO ids FROM pg_temp.market_brain_v50_ids;
  SELECT payload::timestamptz INTO base_time
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'base_time';
  SELECT payload, sha256 INTO manifest_payload, manifest_sha
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'manifest';
  SELECT payload, sha256 INTO shadow_payload, shadow_sha
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'shadow';
  SELECT payload, sha256 INTO capture_payload, capture_sha
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'capture';
  SELECT payload, sha256 INTO input_payload, input_sha
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'input';
  SELECT payload, sha256 INTO forged_payload, forged_sha
    FROM pg_temp.market_brain_v50_fixture WHERE name = 'forged_input';

  manifest_doc := manifest_payload::jsonb || jsonb_build_object('checksum', manifest_sha);
  shadow_doc := shadow_payload::jsonb;
  capture_doc := capture_payload::jsonb || jsonb_build_object('checksum', capture_sha);
  input_doc := input_payload::jsonb || jsonb_build_object('checksum', input_sha);
  forged_doc := forged_payload::jsonb || jsonb_build_object('checksum', forged_sha);

  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.nfl_market_brain_research_manifests (
    id, manifest_release, candidate_release, manifest_checksum, manifest,
    manifest_payload, created_at
  ) VALUES (
    ids.manifest_id, manifest_doc ->> 'release', manifest_doc ->> 'candidateRelease',
    manifest_sha, manifest_doc, manifest_payload, base_time - interval '10 minutes'
  );
  INSERT INTO public.nfl_market_brain_shadow_snapshots (
    id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
    provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
    prior_artifact_sha256, bytes, created_at
  ) VALUES (
    ids.shadow_id, ids.shadow_release, ids.contract_release, ids.attempt_id, ids.attempt_id,
    2026, 8, ids.event_id, 'unlocked', (shadow_doc ->> 'capturedAt')::timestamptz,
    shadow_doc, shadow_sha, shadow_payload, NULL, (shadow_doc ->> 'bytes')::integer,
    (shadow_doc #>> '{case,evaluatedAt}')::timestamptz
  );
  INSERT INTO public.nfl_market_brain_capture_sets (
    id, capture_set_checksum, capture_set_release, event_id, shadow_release,
    contract_release, manifest_checksum, partition_role, fold_id, window_opens_at,
    window_closes_at, cutoff_at, starts_at, expected_capture_attempts,
    successful_captures, failed_captures, capture_set, capture_set_payload, bytes,
    created_at
  ) VALUES (
    ids.capture_id, capture_sha, capture_doc ->> 'release', ids.event_id,
    ids.shadow_release, ids.contract_release, manifest_sha,
    capture_doc ->> 'partitionRole', capture_doc ->> 'foldId',
    (capture_doc ->> 'captureWindowOpensAt')::timestamptz,
    (capture_doc ->> 'captureWindowClosesAt')::timestamptz,
    (capture_doc ->> 'cutoffAt')::timestamptz,
    (capture_doc ->> 'startsAt')::timestamptz,
    jsonb_array_length(capture_doc -> 'expectedCaptureAttempts'), 1, 0,
    capture_doc, capture_payload, octet_length(capture_payload),
    base_time - interval '7 minutes 30 seconds'
  );
  PERFORM set_config('session_replication_role', 'origin', true);

  INSERT INTO public.nfl_market_brain_research_inputs (
    id, research_input_checksum, research_input_release, event_id, cutoff_at,
    starts_at, manifest_checksum, capture_set_id, capture_set_checksum,
    sequence_checksum, feature_checksum, research_input, research_input_payload, bytes
  ) VALUES (
    ids.input_id, input_sha, ids.input_release, ids.event_id,
    (input_doc ->> 'cutoffAt')::timestamptz, (input_doc ->> 'startsAt')::timestamptz,
    manifest_sha, ids.capture_id, capture_sha, input_doc ->> 'sequenceChecksum',
    input_doc ->> 'featureChecksum', input_doc, input_payload, octet_length(input_payload)
  );

  BEGIN
    INSERT INTO public.nfl_market_brain_research_inputs (
      research_input_checksum, research_input_release, event_id, cutoff_at,
      starts_at, manifest_checksum, capture_set_id, capture_set_checksum,
      sequence_checksum, feature_checksum, research_input, research_input_payload, bytes
    ) VALUES (
      forged_sha, ids.input_release, ids.event_id,
      (forged_doc ->> 'cutoffAt')::timestamptz, (forged_doc ->> 'startsAt')::timestamptz,
      manifest_sha, ids.capture_id, capture_sha, forged_doc ->> 'sequenceChecksum',
      forged_doc ->> 'featureChecksum', forged_doc, forged_payload, octet_length(forged_payload)
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%decision envelopes differ from the latest captured case%' THEN
      RAISE;
    END IF;
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'v50 accepted a fully rehashed forged decision envelope';
  END IF;
  IF (SELECT count(*) FROM public.nfl_market_brain_research_inputs
       WHERE event_id = ids.event_id) <> 1 THEN
    RAISE EXCEPTION 'v50 decision-envelope proof did not preserve exactly one valid input';
  END IF;
END;
$decision_envelope_proof$;
