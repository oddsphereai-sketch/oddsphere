-- Shared append-only evidence-attempt ledger for every Market Brain product.
-- Applying this migration does not enable capture or predictive authority.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.market_brain_evidence_attempts (
  release text NOT NULL,
  attempt_id uuid NOT NULL,
  product_key text NOT NULL CHECK (product_key IN (
    'nfl_daily_edge', 'cfb_daily_edge', 'nba_daily_edge', 'wnba_daily_edge',
    'mlb_daily_edge', 'nhl_daily_edge', 'epl_daily_edge', 'ucl_daily_edge',
    'soccer_world_cup_daily_edge', 'nfl_player_props', 'nba_player_props', 'mlb_player_props'
  )),
  qualification_scope_key text NOT NULL,
  provider text NOT NULL,
  feed text NOT NULL,
  participant text,
  event_id text,
  phase text NOT NULL CHECK (phase IN (
    'provider_opening', 'current', 'pregame_context', 'historical_context', 'settlement'
  )),
  planned_at timestamptz NOT NULL,
  window_opens_at timestamptz NOT NULL,
  window_closes_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'success_with_rows', 'success_empty', 'partial', 'failed', 'skipped'
  )),
  reason_code text CHECK (reason_code IS NULL OR reason_code IN (
    'provider_returned_empty', 'pagination_incomplete', 'parser_partial',
    'identity_incomplete', 'storage_partial', 'provider_failure',
    'authentication_failure', 'rate_limited', 'timeout', 'malformed_response',
    'parser_failure', 'storage_failure', 'cancelled', 'not_due',
    'cadence_suppressed', 'budget_suppressed', 'capture_disabled', 'no_active_events'
  )),
  request_count integer NOT NULL CHECK (request_count >= 0),
  expected_pages integer CHECK (expected_pages IS NULL OR expected_pages >= 0),
  received_pages integer NOT NULL CHECK (received_pages >= 0),
  raw_rows integer NOT NULL CHECK (raw_rows >= 0),
  parsed_rows integer NOT NULL CHECK (parsed_rows >= 0),
  unsupported_rows integer NOT NULL CHECK (unsupported_rows >= 0),
  malformed_rows integer NOT NULL CHECK (malformed_rows >= 0),
  matched_rows integer NOT NULL CHECK (matched_rows >= 0),
  unmatched_rows integer NOT NULL CHECK (unmatched_rows >= 0),
  ambiguous_rows integer NOT NULL CHECK (ambiguous_rows >= 0),
  retained_rows integer NOT NULL CHECK (retained_rows >= 0),
  duplicate_rows integer NOT NULL CHECK (duplicate_rows >= 0),
  filtered_rows integer NOT NULL CHECK (filtered_rows >= 0),
  write_failed_rows integer NOT NULL CHECK (write_failed_rows >= 0),
  response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
  raw_archive_sha256 text CHECK (raw_archive_sha256 IS NULL OR raw_archive_sha256 ~ '^[a-f0-9]{64}$'),
  parser_release text,
  attempt_checksum text NOT NULL CHECK (attempt_checksum ~ '^[a-f0-9]{64}$'),
  attempt_payload jsonb NOT NULL,
  attempt_payload_text text NOT NULL,
  checksum_payload_text text NOT NULL,
  server_created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (release, attempt_id),
  CHECK (window_opens_at <= planned_at AND planned_at <= window_closes_at),
  CHECK (
    (product_key IN ('nfl_daily_edge', 'cfb_daily_edge', 'nba_daily_edge', 'wnba_daily_edge', 'nhl_daily_edge')
      AND qualification_scope_key IN ('moneyline', 'spread', 'total')) OR
    (product_key = 'mlb_daily_edge'
      AND qualification_scope_key IN ('full_game_moneyline', 'full_game_total', 'first_inning_nrfi_yrfi')) OR
    (product_key IN ('epl_daily_edge', 'ucl_daily_edge', 'soccer_world_cup_daily_edge')
      AND qualification_scope_key IN ('match_result', 'double_chance', 'total', 'btts')) OR
    (product_key = 'nfl_player_props' AND qualification_scope_key IN (
      'passing_attempts', 'passing_completions', 'passing_yards', 'rushing_attempts', 'rushing_yards',
      'receptions', 'receiving_yards', 'passing_tds', 'interceptions', 'rushing_receiving_yards',
      'touchdowns', 'anytime_td', 'first_td', 'longest_pass', 'longest_reception', 'longest_rush',
      'fg_made', 'kicking_points'
    )) OR
    (product_key = 'nba_player_props' AND qualification_scope_key IN (
      'points', 'rebounds', 'assists', 'threes', 'points_rebounds_assists', 'points_rebounds',
      'points_assists', 'rebounds_assists', 'blocks', 'steals', 'blocks_steals', 'turnovers',
      'field_goals', 'free_throws_made', 'free_throws_attempted', 'double_double', 'triple_double',
      'points_q1', 'rebounds_q1', 'assists_q1'
    )) OR
    (product_key = 'mlb_player_props' AND qualification_scope_key IN (
      'pitcher_strikeouts', 'pitcher_outs', 'pitcher_hits_allowed', 'pitcher_walks',
      'pitcher_earned_runs', 'pitcher_record_a_win', 'batter_strikeouts', 'batter_hits',
      'batter_total_bases', 'batter_home_runs', 'batter_rbis', 'batter_runs_scored',
      'batter_hits_runs_rbis', 'batter_singles', 'batter_doubles', 'batter_triples',
      'batter_walks', 'batter_stolen_bases', 'first_home_run'
    ))
  ),
  CHECK (completed_at >= planned_at),
  CHECK (started_at IS NULL OR (started_at >= window_opens_at AND started_at <= completed_at)),
  CHECK (expected_pages IS NULL OR received_pages <= expected_pages),
  CHECK (raw_rows = parsed_rows + unsupported_rows + malformed_rows),
  CHECK (parsed_rows = matched_rows + unmatched_rows + ambiguous_rows),
  CHECK (matched_rows = retained_rows + duplicate_rows + filtered_rows + write_failed_rows),
  CHECK ((attempt_payload_text::jsonb = attempt_payload) IS TRUE),
  CHECK ((checksum_payload_text::jsonb = attempt_payload - 'checksum') IS TRUE),
  CHECK ((encode(digest(convert_to(checksum_payload_text, 'UTF8'), 'sha256'), 'hex') = attempt_checksum) IS TRUE),
  CHECK (
    (outcome = 'success_with_rows' AND reason_code IS NULL AND raw_rows > 0 AND started_at IS NOT NULL AND request_count > 0) OR
    (outcome = 'success_empty' AND reason_code = 'provider_returned_empty' AND raw_rows = 0 AND started_at IS NOT NULL AND request_count > 0) OR
    (outcome = 'partial' AND reason_code IN ('pagination_incomplete', 'parser_partial', 'identity_incomplete', 'storage_partial') AND started_at IS NOT NULL AND request_count > 0) OR
    (outcome = 'failed' AND reason_code IN ('provider_failure', 'authentication_failure', 'rate_limited', 'timeout', 'malformed_response', 'parser_failure', 'storage_failure', 'cancelled') AND started_at IS NOT NULL AND request_count > 0) OR
    (outcome = 'skipped' AND reason_code IN ('not_due', 'cadence_suppressed', 'budget_suppressed', 'capture_disabled', 'no_active_events') AND started_at IS NULL AND request_count = 0)
  )
);

CREATE OR REPLACE FUNCTION public.validate_market_brain_evidence_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.release <> 'market_brain_evidence_attempt_2026_10_27_r1_append_only_all_product_ledger'
    OR NEW.attempt_payload <> jsonb_build_object(
      'release', NEW.release,
      'attemptId', NEW.attempt_id::text,
      'product', NEW.product_key,
      'qualificationScopeKey', NEW.qualification_scope_key,
      'provider', NEW.provider,
      'feed', NEW.feed,
      'participant', NEW.participant,
      'eventId', NEW.event_id,
      'phase', NEW.phase,
      'plannedAt', NEW.attempt_payload -> 'plannedAt',
      'windowOpensAt', NEW.attempt_payload -> 'windowOpensAt',
      'windowClosesAt', NEW.attempt_payload -> 'windowClosesAt',
      'startedAt', NEW.attempt_payload -> 'startedAt',
      'completedAt', NEW.attempt_payload -> 'completedAt',
      'outcome', NEW.outcome,
      'reasonCode', NEW.reason_code,
      'requestCount', NEW.request_count,
      'expectedPages', NEW.expected_pages,
      'receivedPages', NEW.received_pages,
      'responseSha256', NEW.response_sha256,
      'rawArchiveSha256', NEW.raw_archive_sha256,
      'parserRelease', NEW.parser_release,
      'accounting', jsonb_build_object(
        'rawRows', NEW.raw_rows,
        'parsedRows', NEW.parsed_rows,
        'unsupportedRows', NEW.unsupported_rows,
        'malformedRows', NEW.malformed_rows,
        'matchedRows', NEW.matched_rows,
        'unmatchedRows', NEW.unmatched_rows,
        'ambiguousRows', NEW.ambiguous_rows,
        'retainedRows', NEW.retained_rows,
        'duplicateRows', NEW.duplicate_rows,
        'filteredRows', NEW.filtered_rows,
        'writeFailedRows', NEW.write_failed_rows
      ),
      'details', NEW.attempt_payload -> 'details',
      'checksum', NEW.attempt_checksum
    )
    OR jsonb_typeof(NEW.attempt_payload -> 'details') IS DISTINCT FROM 'object'
    OR (NEW.attempt_payload ->> 'plannedAt')::timestamptz IS DISTINCT FROM NEW.planned_at
    OR (NEW.attempt_payload ->> 'windowOpensAt')::timestamptz IS DISTINCT FROM NEW.window_opens_at
    OR (NEW.attempt_payload ->> 'windowClosesAt')::timestamptz IS DISTINCT FROM NEW.window_closes_at
    OR (NEW.attempt_payload ->> 'completedAt')::timestamptz IS DISTINCT FROM NEW.completed_at
    OR CASE
      WHEN NEW.started_at IS NULL THEN NEW.attempt_payload -> 'startedAt' IS DISTINCT FROM 'null'::jsonb
      ELSE (NEW.attempt_payload ->> 'startedAt')::timestamptz IS DISTINCT FROM NEW.started_at
    END
  THEN
    RAISE EXCEPTION 'market_brain_evidence_attempts payload/column binding is invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_brain_evidence_attempts_validate
  ON public.market_brain_evidence_attempts;
CREATE TRIGGER market_brain_evidence_attempts_validate
  BEFORE INSERT ON public.market_brain_evidence_attempts
  FOR EACH ROW EXECUTE FUNCTION public.validate_market_brain_evidence_attempt();

CREATE INDEX IF NOT EXISTS market_brain_evidence_attempts_product_time
  ON public.market_brain_evidence_attempts (product_key, completed_at DESC);
CREATE INDEX IF NOT EXISTS market_brain_evidence_attempts_feed_time
  ON public.market_brain_evidence_attempts (provider, feed, participant, completed_at DESC);
CREATE INDEX IF NOT EXISTS market_brain_evidence_attempts_event_time
  ON public.market_brain_evidence_attempts (product_key, event_id, completed_at DESC)
  WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_market_brain_evidence_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'market_brain_evidence_attempts is append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_brain_evidence_attempts_immutable
  ON public.market_brain_evidence_attempts;
CREATE TRIGGER market_brain_evidence_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.market_brain_evidence_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_market_brain_evidence_attempt_mutation();

ALTER TABLE public.market_brain_evidence_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_brain_evidence_attempts FROM anon, authenticated;
GRANT SELECT, INSERT ON public.market_brain_evidence_attempts TO service_role;
