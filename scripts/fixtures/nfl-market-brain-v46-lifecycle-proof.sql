-- Real-PostgreSQL proof of the minimum immutable lifecycle and prediction
-- chronology. Prerequisite receipt times are seeded under replica mode so the
-- prediction receipt trigger itself can be exercised without wall-clock sleeps.
DO $lifecycle$
DECLARE
  base_time timestamptz := (SELECT payload::timestamptz
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'base_time');
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
  success_shadow_doc jsonb;
  success_shadow_text text;
  success_shadow_sha text;
  success_contract_release text;
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
  outcome_source_text text;
  outcome_source_sha text;
  outcome_text text;
  outcome_sha text;
  outcome_doc jsonb;
  outcome_final_at timestamptz;
  forged_doc jsonb;
  forged_payload text;
  forged_sha text;
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
  SELECT payload, sha256 INTO manifest_text, manifest_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'manifest';
  manifest_doc := manifest_payload || jsonb_build_object('checksum', manifest_sha);

  shadow_doc := jsonb_build_object(
    'release', 'proof-shadow-release', 'status', 'capture_failed',
    'productionApplied', false, 'eventId', event_id,
    'capturedAt', to_char(shadow_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reason', 'proof-fixture'
  );
  shadow_text := shadow_doc::text;
  shadow_sha := encode(digest(convert_to(shadow_text, 'UTF8'), 'sha256'), 'hex');
  SELECT payload, sha256 INTO shadow_text, shadow_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'shadow';
  shadow_doc := shadow_text::jsonb;

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
  SELECT payload, sha256 INTO capture_text, capture_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'capture';
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
  SELECT payload, sha256 INTO input_text, input_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'input';
  input_doc := input_payload || jsonb_build_object('checksum', input_sha);

  SELECT payload, sha256 INTO weights_text, weights_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'weights';
  weights_doc := weights_text::jsonb;
  artifact_payload := jsonb_build_object(
    'release', 'proof-artifact-release', 'weightsSha256', weights_sha,
    'trainingManifestChecksum', manifest_sha
  );
  artifact_text := artifact_payload::text;
  artifact_sha := encode(digest(convert_to(artifact_text, 'UTF8'), 'sha256'), 'hex');
  SELECT payload, sha256 INTO artifact_text, artifact_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'artifact';
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

  SELECT payload, sha256 INTO success_shadow_text, success_shadow_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'success_shadow';
  SELECT payload INTO success_contract_release
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'success_contract_release';
  success_shadow_doc := success_shadow_text::jsonb;
  INSERT INTO public.nfl_market_brain_shadow_snapshots (
    id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
    provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
    prior_artifact_sha256, bytes, created_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000110', 'proof-shadow-release', success_contract_release,
    '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000111',
    2026, 8, 'proof-success-event', 'unlocked', base_time - interval '5 minutes',
    success_shadow_doc, success_shadow_sha, success_shadow_text, NULL,
    octet_length(success_shadow_text), base_time - interval '3 minutes'
  );

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
  SELECT payload, sha256 INTO prediction_text, prediction_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'prediction';
  prediction_doc := prediction_text::jsonb;
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

  SELECT payload INTO success_shadow_text
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'success_shadow';
  success_shadow_doc := success_shadow_text::jsonb;
  BEGIN
    forged_doc := jsonb_set(success_shadow_doc, '{case,release}', '"wrong-contract"'::jsonb);
    forged_payload := forged_doc::text;
    forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000211', 'proof-shadow-release', success_contract_release,
      '00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000212',
      2026, 8, 'proof-success-event', 'unlocked', base_time - interval '5 minutes',
      forged_doc, forged_sha, forged_payload, NULL, octet_length(forged_payload),
      base_time - interval '3 minutes'
    );
    RAISE EXCEPTION 'success shadow contract mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  BEGIN
    forged_doc := jsonb_set(success_shadow_doc, '{case,eventId}', '"wrong-success-event"'::jsonb);
    forged_payload := forged_doc::text;
    forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000215', 'proof-shadow-release', success_contract_release,
      '00000000-0000-4000-8000-000000000216', '00000000-0000-4000-8000-000000000216',
      2026, 8, 'proof-success-event', 'unlocked', base_time - interval '5 minutes',
      forged_doc, forged_sha, forged_payload, NULL, octet_length(forged_payload),
      base_time - interval '3 minutes'
    );
    RAISE EXCEPTION 'success shadow event mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  BEGIN
    forged_doc := jsonb_set(success_shadow_doc, '{bytes}', '1'::jsonb);
    forged_payload := forged_doc::text;
    forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000217', 'proof-shadow-release', success_contract_release,
      '00000000-0000-4000-8000-000000000218', '00000000-0000-4000-8000-000000000218',
      2026, 8, 'proof-success-event', 'unlocked', base_time - interval '5 minutes',
      forged_doc, forged_sha, forged_payload, NULL, octet_length(forged_payload),
      base_time - interval '3 minutes'
    );
    RAISE EXCEPTION 'success shadow embedded byte mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  BEGIN
    forged_doc := jsonb_set(success_shadow_doc, '{case,evaluatedAt}',
      to_jsonb(to_char((statement_timestamp() + interval '1 hour') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    forged_payload := forged_doc::text;
    forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000213', 'proof-shadow-release', success_contract_release,
      '00000000-0000-4000-8000-000000000214', '00000000-0000-4000-8000-000000000214',
      2026, 8, 'proof-success-event', 'unlocked', base_time - interval '5 minutes',
      forged_doc, forged_sha, forged_payload, NULL, octet_length(forged_payload),
      base_time - interval '3 minutes'
    );
    RAISE EXCEPTION 'post-receipt success evaluation was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
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

  SELECT payload, sha256 INTO outcome_source_text, outcome_source_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'outcome_source';
  SELECT payload, sha256 INTO outcome_text, outcome_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'outcome';
  outcome_doc := outcome_text::jsonb || jsonb_build_object('checksum', outcome_sha);
  outcome_final_at := (outcome_doc ->> 'finalAt')::timestamptz;
  INSERT INTO public.games (
    id, external_id, sport, status, away_score, home_score, provider_ids, updated_at
  ) VALUES (
    9001, 900100, 'nfl', 'final', 17, 20,
    '{"balldontlie":"900100"}'::jsonb, outcome_final_at
  );
  INSERT INTO public.nfl_market_brain_research_outcomes (
    outcome_checksum, event_id, game_id, source_row_sha256, source_row_payload,
    final_at, outcome, outcome_payload, bytes
  ) VALUES (
    outcome_sha, '900100', 9001, outcome_source_sha, outcome_source_text,
    outcome_final_at, outcome_doc, outcome_text, octet_length(outcome_text)
  );

  BEGIN
    outcome_doc := jsonb_set(outcome_doc, '{source,table}', '"not_games"'::jsonb);
    outcome_text := (outcome_doc - 'checksum')::text;
    outcome_sha := encode(digest(convert_to(outcome_text, 'UTF8'), 'sha256'), 'hex');
    outcome_doc := (outcome_doc - 'checksum') || jsonb_build_object('checksum', outcome_sha);
    INSERT INTO public.nfl_market_brain_research_outcomes (
      outcome_checksum, event_id, game_id, source_row_sha256, source_row_payload,
      final_at, outcome, outcome_payload, bytes
    ) VALUES (outcome_sha, '900100', 9001, outcome_source_sha, outcome_source_text,
      outcome_final_at, outcome_doc, outcome_text, octet_length(outcome_text));
    RAISE EXCEPTION 'wrong outcome source table was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'wrong outcome source table was accepted' OR
       position('outcome payload diverges' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT payload, sha256 INTO outcome_text, outcome_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'outcome';
  outcome_doc := outcome_text::jsonb || jsonb_build_object('checksum', outcome_sha);
  BEGIN
    INSERT INTO public.nfl_market_brain_research_outcomes (
      outcome_checksum, event_id, game_id, source_row_sha256, source_row_payload,
      final_at, outcome, outcome_payload, bytes
    ) VALUES (outcome_sha, '900100', 9001, outcome_source_sha, outcome_source_text,
      outcome_final_at + interval '1 second', outcome_doc, outcome_text, octet_length(outcome_text));
    RAISE EXCEPTION 'mismatched final timestamp was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mismatched final timestamp was accepted' OR
       position('outcome payload diverges' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  INSERT INTO public.games (
    id, external_id, sport, status, away_score, home_score, provider_ids, updated_at
  ) VALUES (
    9002, 900200, 'nba', 'final', 90, 100,
    '{"balldontlie":"900200"}'::jsonb, outcome_final_at
  );
  forged_doc := jsonb_build_object(
    'id', 9002, 'externalId', 900200, 'sport', 'nba', 'status', 'final',
    'awayScore', 90, 'homeScore', 100,
    'providerIds', '{"balldontlie":"900200"}'::jsonb,
    'updatedAt', to_char(outcome_final_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  forged_payload := forged_doc::text;
  forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
  outcome_doc := jsonb_build_object(
    'eventId', '900200',
    'finalAt', to_char(outcome_final_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'awayScore', 90, 'homeScore', 100,
    'source', jsonb_build_object(
      'table', 'games', 'gameRecordId', '9002',
      'providerIds', '{"balldontlie":"900200"}'::jsonb,
      'sourceUpdatedAt', to_char(outcome_final_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sourceRowSha256', forged_sha
    )
  );
  outcome_text := outcome_doc::text;
  outcome_sha := encode(digest(convert_to(outcome_text, 'UTF8'), 'sha256'), 'hex');
  outcome_doc := outcome_doc || jsonb_build_object('checksum', outcome_sha);
  BEGIN
    INSERT INTO public.nfl_market_brain_research_outcomes (
      outcome_checksum, event_id, game_id, source_row_sha256, source_row_payload,
      final_at, outcome, outcome_payload, bytes
    ) VALUES (outcome_sha, '900200', 9002, forged_sha, forged_payload,
      outcome_final_at, outcome_doc, outcome_text, octet_length(outcome_text));
    RAISE EXCEPTION 'non-NFL outcome was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'non-NFL outcome was accepted' OR
       position('not backed by an exact finalized games row' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  SELECT payload, sha256 INTO shadow_text, shadow_sha
    FROM pg_temp.market_brain_lifecycle_fixture WHERE name = 'shadow';
  shadow_doc := shadow_text::jsonb;
  BEGIN
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000201', 'proof-shadow-release', 'proof-contract-release',
      '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000202',
      2026, 8, 'wrong-event', 'unlocked', shadow_time, shadow_doc, shadow_sha, shadow_text,
      NULL, octet_length(shadow_text), shadow_time
    );
    RAISE EXCEPTION 'shadow event mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  BEGIN
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000203', 'wrong-release', 'proof-contract-release',
      '00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000204',
      2026, 8, event_id, 'unlocked', shadow_time, shadow_doc, shadow_sha, shadow_text,
      NULL, octet_length(shadow_text), shadow_time
    );
    RAISE EXCEPTION 'shadow release mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  BEGIN
    INSERT INTO public.nfl_market_brain_shadow_snapshots (
      id, shadow_release, contract_release, run_id, capture_attempt_id, season, week,
      provider_game_id, stage, captured_at, shadow, shadow_sha256, shadow_payload,
      prior_artifact_sha256, bytes, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000205', 'proof-shadow-release', 'proof-contract-release',
      '00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000206',
      2026, 8, event_id, 'unlocked', shadow_time - interval '2 minutes', shadow_doc,
      shadow_sha, shadow_text, NULL, octet_length(shadow_text), shadow_time
    );
    RAISE EXCEPTION 'shadow capture timestamp mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;

  forged_payload := '{"eventId":"proof-event"}';
  forged_sha := encode(digest(convert_to(forged_payload, 'UTF8'), 'sha256'), 'hex');
  forged_doc := forged_payload::jsonb || jsonb_build_object('sha256', forged_sha);
  BEGIN
    INSERT INTO public.nfl_market_brain_prior_artifacts (
      artifact_sha256, shadow_release, contract_release, provider_game_id,
      prior_artifact, artifact_payload, bytes
    ) VALUES (
      forged_sha, 'proof-shadow-release', 'proof-contract-release', 'wrong-event',
      forged_doc, forged_payload, octet_length(forged_payload)
    );
    RAISE EXCEPTION 'prior artifact event mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
END;
$lifecycle$;

DO $assert_lifecycle$
BEGIN
  IF (SELECT count(*) FROM public.nfl_market_brain_research_predictions WHERE event_id = 'proof-event') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one valid lifecycle prediction';
  END IF;
  IF (SELECT count(*) FROM public.nfl_market_brain_research_outcomes WHERE event_id = '900100') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one valid lifecycle outcome';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.nfl_market_brain_shadow_snapshots
     WHERE provider_game_id = 'proof-success-event'
       AND (shadow #>> '{case,evaluatedAt}')::timestamptz <= created_at
  ) THEN
    RAISE EXCEPTION 'valid success shadow receipt chronology was not persisted';
  END IF;
END;
$assert_lifecycle$;
