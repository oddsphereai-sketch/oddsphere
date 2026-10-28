-- Oddsphere · Schema Migration V51 — Market-price provider lineage
--
-- The original V2 price table stored the book but not the provider that
-- supplied the observation. Preserve every existing row as
-- legacy_unattributed; only future captures may claim Owls or canonical-lines
-- provenance. This migration does not rewrite prices, timestamps, or picks.

ALTER TABLE public.market_price_observations_v2
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'legacy_unattributed',
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
  ADD COLUMN IF NOT EXISTS ingestion_run_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload_hash TEXT;

ALTER TABLE public.market_price_observations_v2
  ALTER COLUMN provider SET DEFAULT 'legacy_unattributed';

ALTER TABLE public.market_price_observations_v2
  DROP CONSTRAINT IF EXISTS market_price_observations_v2_provider_not_null,
  ADD CONSTRAINT market_price_observations_v2_provider_not_null
    CHECK (provider IS NOT NULL) NOT VALID;

-- Validation scans but does not rewrite the approximately 3.8 million legacy
-- rows and does not require an access-exclusive lock for the duration.
ALTER TABLE public.market_price_observations_v2
  VALIDATE CONSTRAINT market_price_observations_v2_provider_not_null;

ALTER TABLE public.market_price_observations_v2
  ALTER COLUMN provider SET NOT NULL,
  DROP CONSTRAINT market_price_observations_v2_provider_not_null;

ALTER TABLE public.market_price_observations_v2
  DROP CONSTRAINT IF EXISTS market_price_observations_v2_provider_chk,
  ADD CONSTRAINT market_price_observations_v2_provider_chk
    CHECK (provider IN ('owls', 'canonical_lines', 'legacy_unattributed')),
  DROP CONSTRAINT IF EXISTS market_price_observations_v2_payload_hash_chk,
  ADD CONSTRAINT market_price_observations_v2_payload_hash_chk
    CHECK (raw_payload_hash IS NULL OR raw_payload_hash ~ '^[a-f0-9]{64}$');

-- Build the replacement while reads and writes continue. This statement must
-- remain outside an explicit transaction block.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  market_price_observations_v2_unique_price_provider_idx
  ON public.market_price_observations_v2
  (provider, canonical_market_id, sportsbook, selection_key, line,
   american_price, provider_timestamp);

BEGIN;

ALTER TABLE public.market_price_observations_v2
  DROP CONSTRAINT IF EXISTS market_price_observations_v2_unique_price,
  ADD CONSTRAINT market_price_observations_v2_unique_price
    UNIQUE USING INDEX market_price_observations_v2_unique_price_provider_idx;

COMMENT ON COLUMN public.market_price_observations_v2.provider IS
  'Actual capture origin. Existing pre-V51 rows are legacy_unattributed and must never be inferred or relabeled.';
COMMENT ON COLUMN public.market_price_observations_v2.raw_payload_hash IS
  'SHA-256 of the normalized provider row supplied to the canonical adapter; NULL only for legacy or canonical-lines observations without exact source-row provenance.';

COMMIT;
