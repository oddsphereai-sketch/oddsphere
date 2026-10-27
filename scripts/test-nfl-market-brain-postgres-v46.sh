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
upgrade_sql="${repo_root}/lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql"

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
       AND relation.relname LIKE 'nfl_market_brain_%'
  ) THEN
    RAISE EXCEPTION 'PostgreSQL proof requires a clean database with no public.nfl_market_brain_* relations';
  END IF;
END;
$clean_database$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$roles$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.games (
  id bigint PRIMARY KEY,
  external_id text NOT NULL,
  status text NOT NULL,
  away_score integer,
  home_score integer,
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
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

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'nfl_market_brain_prediction_research_input_fk'
       AND conrelid <> 'public.nfl_market_brain_research_predictions'::regclass
  ) THEN
    RAISE EXCEPTION 'prediction constraint lookup escaped the intended relation';
  END IF;
END;
$assertions$;

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

SELECT CASE
  WHEN encode(digest(convert_to('{"Z":0,"a":2,"ä":1,"\ud800":4,"😀":3}', 'UTF8'), 'sha256'), 'hex')
       = '03cafa78ea77417a9c2c4c4d4c5dd1c9a2e5a556035092aad3ae6468c0709d01'
  THEN true
  ELSE pg_catalog.boolin('canonical PostgreSQL hash vector mismatch')
END;
SQL

echo "NFL Market Brain PostgreSQL v45 -> v46 upgrade, refusal, idempotence, catalog, and hash proof passed."
