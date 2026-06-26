-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V29 — Market Intelligence v2 ticket-share source
-- ═════════════════════════════════════════════════════════════════════════════
--
-- BetMGM public_bet_pct / ticket-share evidence must not be represented as
-- handle or money percentage. Add an explicit source_type so the canonical
-- table can store ticket-only observations honestly.

BEGIN;

ALTER TABLE market_split_observations_v2
  DROP CONSTRAINT IF EXISTS market_split_observations_v2_source_type_chk;

ALTER TABLE market_split_observations_v2
  ADD CONSTRAINT market_split_observations_v2_source_type_chk
  CHECK (source_type IN (
    'multi_book_consensus',
    'retail_book',
    'sharp_adjacent_book',
    'retail_ticket_share'
  ));

COMMIT;
