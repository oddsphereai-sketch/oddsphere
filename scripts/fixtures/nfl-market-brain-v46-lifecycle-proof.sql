-- Real-PostgreSQL proof of the minimum immutable lifecycle and prediction
-- chronology. Prerequisite receipt times are seeded under replica mode so the
-- prediction receipt trigger itself can be exercised without wall-clock sleeps.
DO $lifecycle$
DECLARE
  base_time timestamptz := statement_timestamp();
  manifest_created timestamptz := base_time - interval '10 minutes';
  window_opens timestamptz := base_time - interval '9 minutes';
  shadow_time timestamptz := base_time - interval '8 minutes 30 seconds';
  window_closes timestamptz := base_time - interval '8 minutes';
  capture_created timestamptz := base_time - interval '7 minutes 30 seconds';
  cutoff_time timestamptz := base_time - interval '7 minutes';
  research_created timestamptz := base_time - interval '6 minutes 30 seconds';
  inferred_time timestamptz := base_time - interval '6 minutes';
  starts_time timestamptz := base_time + interval '10 minutes';
  shadow_id uuid := '00000000-0000-4000-8000-000000000101';
  attempt_id uuid := '00000000-0000-4000-8000-000000000102';
  capture_id uuid := '00000000-0000-4000-8000-000000000103';
  input_id uuid := '00000000-0000-4000-8000-000000000104';
  event_id text := 'proof-event';
  manifest_payload jsonb;
  manifest_doc jsonb;
  manifest_text text;
  manifest_sha text;
  shadow_doc jsonb;
  shadow_text text;
  shadow_sha text;
  capture_payload jsonb;
  capture_doc jsonb;
  capture_text text;
  capture_sha text;
  sequence_sha text := repeat('1', 64);
  feature_sha text := repeat('2', 64);
  input_payload jsonb;
  input_doc jsonb;
  input_text text;
  input_sha text;
  weights_doc jsonb := '{"intercept":0}'::jsonb;
  weights_text text := '{"intercept":0}';
  weights_sha text;
  artifact_payload jsonb;
  artifact_doc jsonb;
  artifact_text text;
  artifact_sha text;
  resolver_sha text := repeat('3', 64);
  prediction_doc jsonb;
  prediction_text text;
  prediction_sha text;
BEGIN
  manifest_payload := jsonb_build_object(
    'storageId', 'proof-manifest',
    'candidateRelease', 'proof-candidate',
    'release', 'proof-manifest-release',
    'createdAt', to_char(manifest_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'partitions', jsonb_build_array(jsonb_build_object(
      'role', 'prospective_shadow',
      'events', jsonb_build_array(jsonb_build_object(
        'eventId', event_id,
        'captureWindowOpensAt', to_char(window_opens AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'captureWindowClosesAt', to_char(window_closes AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'startsAt', to_char(starts_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expectedCaptureAttempts', jsonb_build_array(jsonb_build_object(
          'runId', attempt_id::text, 'stage', 'unlocked'
        ))
      ))
    ))
  );
  manifest_text := manifest_payload::text;
  manifest_sha := encode(digest(convert_to(manifest_text, 'UTF8'), 'sha256'), 'hex');
  manifest_doc := manifest_payload || jsonb_build_object('checksum', manifest_sha);

  shadow_doc := jsonb_build_object(
    'release', 'proof-shadow-release', 'status', 'capture_failed',
    'productionApplied', false, 'eventId', event_id,
    'capturedAt', to_char(shadow_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', 'proof-fixture'
  );
  shadow_text := shadow_doc::text;
  shadow_sha := encode(digest(convert_to(shadow_text, 'UTF8'), 'sha256'), 'hex');

  capture_payload := jsonb_build_object(
    'release', 'proof-capture-set-release', 'eventId', event_id,
    'shadowRelease', 'proof-shadow-release', 'contractRelease', 'proof-contract-release',
    'manifestChecksum', manifest_sha, 'partitionRole', 'prospective_shadow', 'foldId', 'proof-fold',
    'captureWindowOpensAt', to_char(window_opens AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'captureWindowClosesAt', to_char(window_closes AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startsAt', to_char(starts_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expectedCaptureAttempts', jsonb_build_array(jsonb_build_object('runId', attempt_id::text, 'stage', 'unlocked')),
    'membership', jsonb_build_array(jsonb_build_object(
      'recordId', shadow_id::text, 'runId', attempt_id::text, 'stage', 'unlocked',
      'shadowSha256', shadow_sha,
      'capturedAt', to_char(shadow_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'serverCreatedAt', to_char(shadow_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status', 'capture_failed'
    )),
    'successfulCaptures', 0, 'failedCaptures', 1
  );
  capture_text := capture_payload::text;
  capture_sha := encode(digest(convert_to(capture_text, 'UTF8'), 'sha256'), 'hex');
  capture_doc := capture_payload || jsonb_build_object('checksum', capture_sha);

  input_payload := jsonb_build_object(
    'release', 'proof-input-release', 'eventId', event_id,
    'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startsAt', to_char(starts_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'manifestChecksum', manifest_sha, 'captureSetRecordId', capture_id::text,
    'captureSetChecksum', capture_sha, 'sequenceChecksum', sequence_sha, 'featureChecksum', feature_sha,
    'sequence', jsonb_build_object(
      'release', 'proof-sequence-release', 'checksum', sequence_sha, 'eventId', event_id,
      'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'startsAt', to_char(starts_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'features', jsonb_build_object(
      'release', 'proof-feature-release', 'checksum', feature_sha, 'eventId', event_id,
      'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'inputSequenceChecksum', sequence_sha, 'inputSequenceRelease', 'proof-sequence-release'
    )
  );
  input_text := input_payload::text;
  input_sha := encode(digest(convert_to(input_text, 'UTF8'), 'sha256'), 'hex');
  input_doc := input_payload || jsonb_build_object('checksum', input_sha);

  weights_sha := encode(digest(convert_to(weights_text, 'UTF8'), 'sha256'), 'hex');
  artifact_payload := jsonb_build_object(
    'release', 'proof-artifact-release', 'weightsSha256', weights_sha,
    'trainingManifestChecksum', manifest_sha
  );
  artifact_text := artifact_payload::text;
  artifact_sha := encode(digest(convert_to(artifact_text, 'UTF8'), 'sha256'), 'hex');
  artifact_doc := artifact_payload || jsonb_build_object('sha256', artifact_sha);

  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.nfl_market_brain_research_manifests (
    id, manifest_release, candidate_release, manifest_checksum, manifest, manifest_payload, created_at
  ) VALUES ('proof-manifest', 'proof-manifest-release', 'proof-candidate', manifest_sha,
    manifest_doc, manifest_text, manifest_created);
  INSERT INTO public.nfl_market_brain_shadow_snapshots (
    id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
    provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
    prior_artifact_sha256, bytes, created_at
  ) VALUES (shadow_id, 'proof-shadow-release', 'proof-contract-release', attempt_id, attempt_id,
    2026, 8, event_id, 'unlocked', shadow_time, shadow_doc, shadow_sha, shadow_text,
    NULL, octet_length(shadow_text), shadow_time);
  INSERT INTO public.nfl_market_brain_capture_sets (
    id, capture_set_checksum, capture_set_release, event_id, shadow_release, contract_release,
    manifest_checksum, partition_role, fold_id, window_opens_at, window_closes_at, cutoff_at,
    starts_at, expected_capture_attempts, successful_captures, failed_captures,
    capture_set, capture_set_payload, bytes, created_at
  ) VALUES (capture_id, capture_sha, 'proof-capture-set-release', event_id, 'proof-shadow-release',
    'proof-contract-release', manifest_sha, 'prospective_shadow', 'proof-fold', window_opens,
    window_closes, cutoff_time, starts_time, 1, 0, 1, capture_doc, capture_text,
    octet_length(capture_text), capture_created);
  INSERT INTO public.nfl_market_brain_research_inputs (
    id, research_input_checksum, research_input_release, event_id, cutoff_at, starts_at,
    manifest_checksum, capture_set_id, capture_set_checksum, sequence_checksum, feature_checksum,
    research_input, research_input_payload, bytes, created_at
  ) VALUES (input_id, input_sha, 'proof-input-release', event_id, cutoff_time, starts_time,
    manifest_sha, capture_id, capture_sha, sequence_sha, feature_sha, input_doc, input_text,
    octet_length(input_text), research_created);
  INSERT INTO public.nfl_market_brain_resolver_artifacts (
    artifact_sha256, weights_sha256, artifact_release, training_manifest_checksum,
    artifact, weights, artifact_payload, weights_payload, bytes, created_at
  ) VALUES (artifact_sha, weights_sha, 'proof-artifact-release', manifest_sha,
    artifact_doc, weights_doc, artifact_text, weights_text,
    octet_length(artifact_text) + octet_length(weights_text), research_created);
  PERFORM set_config('session_replication_role', 'origin', true);

  prediction_doc := jsonb_build_object(
    'eventId', event_id,
    'cutoffAt', to_char(cutoff_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startsAt', to_char(starts_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'inferredAt', to_char(inferred_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'release', 'proof-candidate', 'artifactSha256', artifact_sha,
    'trainingManifestChecksum', manifest_sha, 'researchInputRecordId', input_id::text,
    'researchInputChecksum', input_sha, 'captureSetChecksum', capture_sha,
    'resolverOutputChecksum', resolver_sha, 'sequenceChecksum', sequence_sha,
    'featureChecksum', feature_sha
  );
  prediction_text := prediction_doc::text;
  prediction_sha := encode(digest(convert_to(prediction_text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.nfl_market_brain_research_predictions (
    prediction_sha256, event_id, cutoff_at, starts_at, candidate_release, artifact_sha256,
    training_manifest_checksum, research_input_id, research_input_checksum, capture_set_checksum,
    resolver_output_checksum, sequence_checksum, feature_checksum, prediction, prediction_payload, bytes
  ) VALUES (prediction_sha, event_id, cutoff_time, starts_time, 'proof-candidate', artifact_sha,
    manifest_sha, input_id, input_sha, capture_sha, resolver_sha, sequence_sha, feature_sha,
    prediction_doc, prediction_text, octet_length(prediction_text));

  BEGIN
    prediction_doc := jsonb_set(prediction_doc, '{inferredAt}',
      to_jsonb(to_char((cutoff_time - interval '1 millisecond') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    prediction_text := prediction_doc::text;
    INSERT INTO public.nfl_market_brain_research_predictions (
      prediction_sha256, event_id, cutoff_at, starts_at, candidate_release, artifact_sha256,
      training_manifest_checksum, research_input_id, research_input_checksum, capture_set_checksum,
      resolver_output_checksum, sequence_checksum, feature_checksum, prediction, prediction_payload, bytes
    ) VALUES (encode(digest(convert_to(prediction_text, 'UTF8'), 'sha256'), 'hex'), event_id,
      cutoff_time, starts_time, 'proof-candidate', artifact_sha, manifest_sha, input_id, input_sha,
      capture_sha, resolver_sha, sequence_sha, feature_sha, prediction_doc, prediction_text,
      octet_length(prediction_text));
    RAISE EXCEPTION 'pre-cutoff prediction was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'pre-cutoff prediction was accepted' OR
       position('was not received pregame after inference' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    prediction_doc := jsonb_set(prediction_doc, '{inferredAt}',
      to_jsonb(to_char((base_time + interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    prediction_text := prediction_doc::text;
    INSERT INTO public.nfl_market_brain_research_predictions (
      prediction_sha256, event_id, cutoff_at, starts_at, candidate_release, artifact_sha256,
      training_manifest_checksum, research_input_id, research_input_checksum, capture_set_checksum,
      resolver_output_checksum, sequence_checksum, feature_checksum, prediction, prediction_payload, bytes
    ) VALUES (encode(digest(convert_to(prediction_text, 'UTF8'), 'sha256'), 'hex'), event_id,
      cutoff_time, starts_time, 'proof-candidate', artifact_sha, manifest_sha, input_id, input_sha,
      capture_sha, resolver_sha, sequence_sha, feature_sha, prediction_doc, prediction_text,
      octet_length(prediction_text));
    RAISE EXCEPTION 'future-inference prediction was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'future-inference prediction was accepted' OR
       position('was not received pregame after inference' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$lifecycle$;

DO $assert_lifecycle$
BEGIN
  IF (SELECT count(*) FROM public.nfl_market_brain_research_predictions WHERE event_id = 'proof-event') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one valid lifecycle prediction';
  END IF;
END;
$assert_lifecycle$;
