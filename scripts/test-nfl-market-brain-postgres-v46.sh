#!/usr/bin/env bash
set -euo pipefail

database_url="${MARKET_BRAIN_POSTGRES_URL:-}"
if [[ -z "${database_url}" ]]; then
  echo "MARKET_BRAIN_POSTGRES_URL is required for the real PostgreSQL v46 proof" >&2
  exit 2
fi
if [[ "${MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE:-}" != "YES" ]]; then
  echo "Refusing database writes without MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE=YES" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy_sql="${repo_root}/scripts/fixtures/nfl-market-brain-v45-installed.sql"
expanded_v45_sql="${repo_root}/lib/db/schema-migration-v45-nfl-market-brain-shadow.sql"
upgrade_sql="${repo_root}/lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql"
evidence_attempt_sql="${repo_root}/lib/db/schema-migration-v47-market-brain-evidence-attempts.sql"
capture_plan_sql="${repo_root}/lib/db/schema-migration-v48-market-brain-capture-plans.sql"
attempt_claim_sql="${repo_root}/lib/db/schema-migration-v49-market-brain-attempt-claims.sql"
decision_envelope_sql="${repo_root}/lib/db/schema-migration-v50-nfl-market-brain-decision-envelopes.sql"
lifecycle_sql="${repo_root}/scripts/fixtures/nfl-market-brain-v46-lifecycle-proof.sql"
decision_envelope_proof_sql="${repo_root}/scripts/fixtures/nfl-market-brain-v50-decision-envelope-proof.sql"
lifecycle_prelude="$(mktemp)"
capture_plan_prelude="$(mktemp)"
decision_envelope_prelude="$(mktemp)"
trap 'rm -f "${lifecycle_prelude}" "${capture_plan_prelude}" "${decision_envelope_prelude}"' EXIT

psql_run() {
  psql "${database_url}" -X -v ON_ERROR_STOP=1 "$@"
}

database_name="$(psql_run -Atqc 'SELECT current_database()')"
if [[ "${database_name}" != "oddsphere_market_brain_test" ]]; then
  echo "Refusing database writes: expected disposable database oddsphere_market_brain_test, got ${database_name}" >&2
  exit 2
fi

psql_run <<'SQL'
DO $clean_database$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND (relation.relname LIKE 'nfl_market_brain_%' OR relation.relname LIKE 'market_brain_%')
  ) THEN
    RAISE EXCEPTION 'PostgreSQL proof requires a clean database with no public.nfl_market_brain_* relations';
  END IF;
END;
$clean_database$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$roles$;
ALTER ROLE service_role BYPASSRLS;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.games (
  id bigint PRIMARY KEY,
  external_id integer NOT NULL,
  sport text NOT NULL,
  status text NOT NULL,
  away_score integer,
  home_score integer,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
SQL

# The checked-in expanded v45 source was installable under the same release
# name as the original two-table migration. Prove that an empty installation
# follows an explicit supported path and reaches the composite parser identity.
psql_run -f "${expanded_v45_sql}"
psql_run <<'SQL'
INSERT INTO public.nfl_market_brain_raw_parser_inputs (
  parser_input_sha256, schema_release, parser_input, parser_input_payload, bytes
) VALUES (
  encode(digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'), 'expanded-v45-fixture', '[]'::jsonb, '[]', 2
);
SQL
failure_log="$(mktemp)"
if psql_run -f "${upgrade_sql}" >"${failure_log}" 2>&1; then
  echo "v46 unexpectedly replaced a nonempty expanded v45 schema" >&2
  rm -f "${failure_log}"
  exit 1
fi
grep -q "refuses to replace nonempty expanded v45 table" "${failure_log}"
rm -f "${failure_log}"
psql_run -Atqc "SELECT count(*) FROM public.nfl_market_brain_raw_parser_inputs" | grep -qx '1'
psql_run -c "DELETE FROM public.nfl_market_brain_raw_parser_inputs WHERE schema_release = 'expanded-v45-fixture'"
psql_run -f "${upgrade_sql}"
psql_run -f "${upgrade_sql}"
psql_run -Atqc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.nfl_market_brain_raw_parser_inputs'::regclass AND contype = 'p'" \
  | grep -qx 'PRIMARY KEY (schema_release, parser_input_sha256)'

psql_run <<'SQL'
DROP TABLE public.nfl_market_brain_research_predictions;
DROP TABLE public.nfl_market_brain_research_outcomes;
DROP TABLE public.nfl_market_brain_resolver_artifacts;
DROP TABLE public.nfl_market_brain_research_inputs;
DROP TABLE public.nfl_market_brain_capture_sets;
DROP TABLE public.nfl_market_brain_research_manifests;
DROP TABLE public.nfl_market_brain_shadow_snapshots;
DROP TABLE public.nfl_market_brain_prior_artifacts;
DROP TABLE public.nfl_market_brain_raw_parser_inputs;
SQL

psql_run -f "${legacy_sql}"
psql_run <<'SQL'
INSERT INTO public.nfl_market_brain_shadow_snapshots (
  shadow_release, contract_release, run_id, season, week, provider_game_id,
  stage, captured_at, shadow, shadow_sha256, bytes
) VALUES (
  'legacy-shadow', 'legacy-contract', gen_random_uuid(), 2026, 1, 'legacy-event',
  'opening', statement_timestamp(), '{}'::jsonb, repeat('a', 64), 2
);
SQL

failure_log="$(mktemp)"
if psql_run -f "${upgrade_sql}" >"${failure_log}" 2>&1; then
  echo "v46 unexpectedly replaced a nonempty legacy v45 schema" >&2
  rm -f "${failure_log}"
  exit 1
fi
if ! grep -q "refuses to replace nonempty legacy v45 tables" "${failure_log}"; then
  echo "v46 failed for an unexpected reason:" >&2
  sed -n '1,120p' "${failure_log}" >&2
  rm -f "${failure_log}"
  exit 1
fi
rm -f "${failure_log}"
psql_run -Atqc "SELECT count(*) FROM public.nfl_market_brain_shadow_snapshots" | grep -qx '1'

psql_run <<'SQL'
DELETE FROM public.nfl_market_brain_shadow_snapshots
 WHERE shadow_release = 'legacy-shadow' AND provider_game_id = 'legacy-event';
INSERT INTO public.nfl_market_brain_research_manifests (
  id, manifest_release, candidate_release, persisted_at, manifest_checksum, manifest
) VALUES (
  'legacy-manifest', 'legacy-manifest-release', 'legacy-candidate', statement_timestamp(),
  repeat('b', 64),
  jsonb_build_object(
    'storageId', 'legacy-manifest', 'checksum', repeat('b', 64),
    'candidateRelease', 'legacy-candidate', 'release', 'legacy-manifest-release',
    'persistedAt', statement_timestamp(), 'createdAt', statement_timestamp()
  )
);
SQL
failure_log="$(mktemp)"
if psql_run -f "${upgrade_sql}" >"${failure_log}" 2>&1; then
  echo "v46 unexpectedly replaced a legacy v45 schema containing only a manifest" >&2
  rm -f "${failure_log}"
  exit 1
fi
grep -q "refuses to replace nonempty legacy v45 tables" "${failure_log}"
rm -f "${failure_log}"
psql_run -Atqc "SELECT count(*) FROM public.nfl_market_brain_research_manifests" | grep -qx '1'

psql_run <<'SQL'
DELETE FROM public.nfl_market_brain_research_manifests WHERE id = 'legacy-manifest';
ALTER TABLE public.nfl_market_brain_shadow_snapshots ADD COLUMN corrupt_partial_marker text;
SQL
failure_log="$(mktemp)"
if psql_run -f "${upgrade_sql}" >"${failure_log}" 2>&1; then
  echo "v46 unexpectedly accepted an adversarial partial legacy schema" >&2
  rm -f "${failure_log}"
  exit 1
fi
grep -Eq "partial or unrecognized|unrecognized post-v45" "${failure_log}"
rm -f "${failure_log}"

psql_run <<'SQL'
DROP TABLE public.nfl_market_brain_research_manifests;
DROP TABLE public.nfl_market_brain_shadow_snapshots;
SQL
psql_run -f "${legacy_sql}"
psql_run -f "${upgrade_sql}"
psql_run -f "${upgrade_sql}"

psql_run <<'SQL'
DO $assertions$
DECLARE
  table_count integer;
  rls_count integer;
  nullable_json_checks text;
BEGIN
  SELECT count(*) INTO table_count
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relkind = 'r'
     AND relation.relname = ANY (ARRAY[
       'nfl_market_brain_raw_parser_inputs',
       'nfl_market_brain_prior_artifacts',
       'nfl_market_brain_shadow_snapshots',
       'nfl_market_brain_research_manifests',
       'nfl_market_brain_capture_sets',
       'nfl_market_brain_research_inputs',
       'nfl_market_brain_resolver_artifacts',
       'nfl_market_brain_research_predictions',
       'nfl_market_brain_research_outcomes'
     ]);
  IF table_count <> 9 THEN RAISE EXCEPTION 'expected 9 Market Brain tables, found %', table_count; END IF;

  SELECT count(*) INTO rls_count
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relrowsecurity
     AND relation.relname LIKE 'nfl_market_brain_%';
  IF rls_count <> 9 THEN RAISE EXCEPTION 'expected RLS on 9 Market Brain tables, found %', rls_count; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nfl_market_brain_capture_sets'
       AND column_name = 'expected_capture_attempts' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nfl_market_brain_research_inputs'
       AND column_name = 'research_input_release' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'v46 JSON/count binding columns are absent';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'nfl_market_brain_%'
         AND column_name = 'canonical_release') <> 8 THEN
    RAISE EXCEPTION 'canonical serialization release is not persisted on every canonical-hash table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.nfl_market_brain_capture_sets'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) =
         'UNIQUE (event_id, shadow_release, contract_release, manifest_checksum, partition_role, window_opens_at, window_closes_at, cutoff_at, starts_at)'
  ) THEN
    RAISE EXCEPTION 'v46 finalized-window identity is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.nfl_market_brain_raw_parser_inputs'::regclass
       AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (schema_release, parser_input_sha256)'
  ) THEN
    RAISE EXCEPTION 'raw parser archive identity is not bound to schema release plus payload digest';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.nfl_market_brain_research_predictions'::regclass
         AND contype = 'f'
         AND conname = ANY (ARRAY[
           'nfl_market_brain_prediction_research_input_fk',
           'nfl_market_brain_prediction_research_input_checksum_fk',
           'nfl_market_brain_prediction_capture_set_fk'
         ])) <> 3 THEN
    RAISE EXCEPTION 'prediction provenance foreign keys are incomplete';
  END IF;

  SELECT string_agg(
           conrelid::regclass::text || '.' || conname || ': ' || pg_get_constraintdef(oid),
           E'\n' ORDER BY conrelid::regclass::text, conname
         )
    INTO nullable_json_checks
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace
       AND contype = 'c'
       AND conrelid::regclass::text LIKE 'nfl_market_brain_%'
       AND pg_get_constraintdef(oid) ~ '(->>|#>>)'
       AND pg_get_constraintdef(oid) NOT LIKE '%IS TRUE%'
       AND pg_get_constraintdef(oid) NOT LIKE '%IS NOT DISTINCT FROM%';
  IF nullable_json_checks IS NOT NULL THEN
    RAISE EXCEPTION 'JSON relational bindings remain nullable under PostgreSQL CHECK semantics:%',
      E'\n' || nullable_json_checks;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role is not production-equivalent BYPASSRLS';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.nfl_market_brain_research_predictions', 'SELECT') OR
     NOT has_table_privilege('service_role', 'public.nfl_market_brain_research_predictions', 'INSERT') OR
     has_table_privilege('service_role', 'public.nfl_market_brain_research_predictions', 'UPDATE') OR
     has_table_privilege('service_role', 'public.nfl_market_brain_research_predictions', 'DELETE') OR
     has_table_privilege('anon', 'public.nfl_market_brain_research_predictions', 'SELECT') THEN
    RAISE EXCEPTION 'prediction table grants are not append-only and private';
  END IF;
END;
$assertions$;
SQL

npx tsx "${repo_root}/scripts/build-nfl-market-brain-v46-lifecycle-prelude.ts" >"${lifecycle_prelude}"
psql_run -f "${lifecycle_prelude}" -f "${lifecycle_sql}"

psql_run <<'SQL'

WITH fixture AS (
  SELECT '[{"event_id":"same-bytes"}]'::text AS payload
)
INSERT INTO public.nfl_market_brain_raw_parser_inputs (
  parser_input_sha256, schema_release, parser_input, parser_input_payload, bytes
)
SELECT encode(digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex'), schema_release,
       payload::jsonb, payload, octet_length(payload)
  FROM fixture
 CROSS JOIN (VALUES ('fixture_parser_v1'), ('fixture_parser_v2')) releases(schema_release);

DO $schema_collision$
DECLARE archive_count integer;
BEGIN
  SELECT count(*) INTO archive_count
    FROM public.nfl_market_brain_raw_parser_inputs
   WHERE parser_input_sha256 = encode(
     digest(convert_to('[{"event_id":"same-bytes"}]', 'UTF8'), 'sha256'), 'hex'
   );
  IF archive_count <> 2 THEN
    RAISE EXCEPTION 'same parser bytes under two schema releases collapsed to % archive rows', archive_count;
  END IF;
END;
$schema_collision$;

UPDATE public.nfl_market_brain_raw_parser_inputs
   SET expires_at = statement_timestamp() - interval '1 second'
 WHERE schema_release IN ('fixture_parser_v1', 'fixture_parser_v2');
DO $retention_telemetry$
DECLARE purge_result record;
BEGIN
  SELECT * INTO purge_result
    FROM public.purge_expired_nfl_market_brain_research(5000);
  IF purge_result.raw_inputs_deleted <> 2 OR
     purge_result.shadows_deleted <> 0 OR
     purge_result.artifacts_deleted <> 0 OR
     purge_result.raw_input_bytes_remaining <> 0 THEN
    RAISE EXCEPTION 'retention telemetry mismatch: %', row_to_json(purge_result);
  END IF;
END;
$retention_telemetry$;

SELECT CASE
  WHEN encode(digest(convert_to('{"Z":0,"a":2,"ä":1,"\ud800":4,"😀":3}', 'UTF8'), 'sha256'), 'hex')
       = '03cafa78ea77417a9c2c4c4d4c5dd1c9a2e5a556035092aad3ae6468c0709d01'
  THEN true
  ELSE pg_catalog.boolin('canonical PostgreSQL hash vector mismatch')
END;
SQL

psql_run -f "${evidence_attempt_sql}"
psql_run -f "${evidence_attempt_sql}"
psql_run -f "${capture_plan_sql}"
psql_run -f "${capture_plan_sql}"
psql_run -f "${attempt_claim_sql}"
psql_run -f "${attempt_claim_sql}"
npx tsx "${repo_root}/scripts/build-market-brain-v48-lifecycle-proof.ts" >"${capture_plan_prelude}"
psql_run -f "${capture_plan_prelude}"
npx tsx "${repo_root}/scripts/build-nfl-market-brain-v50-decision-envelope-proof.ts" \
  >"${decision_envelope_prelude}"
psql_run -f "${decision_envelope_sql}"
psql_run -f "${decision_envelope_sql}"
psql_run -f "${decision_envelope_prelude}" -f "${decision_envelope_proof_sql}"

echo "Market Brain PostgreSQL v45 -> v50 upgrade, refusal, idempotence, lifecycle, catalog, hash, and decision-envelope binding proof passed."
