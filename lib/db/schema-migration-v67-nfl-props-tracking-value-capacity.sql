-- Oddsphere V67: retain valid long-odds expected values in official NFL tracking.
-- Storage capacity only. Existing locked values, eight-decimal scale, JSON,
-- uniqueness, permissions and every prediction/grade remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.nfl_player_prop_records
  ALTER COLUMN locked_expected_value TYPE NUMERIC(20,8);

COMMIT;
