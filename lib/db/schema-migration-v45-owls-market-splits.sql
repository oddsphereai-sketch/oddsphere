-- Oddsphere · Schema Migration V45 — Owls named-book Market Intelligence splits
--
-- Adds Owls as a provider in the existing append-only Market Intelligence v2
-- split observation lane. Existing Playbook and SharpAPI rows are unchanged.

BEGIN;

ALTER TABLE market_split_observations_v2
  DROP CONSTRAINT IF EXISTS market_split_observations_v2_provider_chk;

ALTER TABLE market_split_observations_v2
  ADD CONSTRAINT market_split_observations_v2_provider_chk
  CHECK (provider IN ('playbook', 'sharpapi', 'owls'));

COMMENT ON TABLE market_split_observations_v2 IS
  'Append-only canonical split observations for Market Intelligence v2. '
  'Percentages are normalized 0..1. Missing values stay NULL, never 0.50. '
  'Playbook is consensus only; Owls is the active named-book provider. Existing legacy SharpAPI rows remain source-specific historical records.';

COMMIT;
