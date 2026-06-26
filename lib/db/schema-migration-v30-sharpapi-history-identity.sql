-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V30 — SharpAPI history source-time identity
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   V28 intentionally retained repeated live provider polls by including
--   fetched_at in the payload identity. That is correct for live Playbook
--   observations where fetched_at is the observation time.
--
--   SharpAPI /splits/history rows are different: each row carries its own
--   provider source timestamp (`ts` / `timestamp`). Re-fetching the same
--   historical row later must not create a new canonical observation just
--   because OddSphere retrieved it at a new fetched_at.
--
-- This migration:
--   1. Backs up the exact duplicate SharpAPI DraftKings/Circa history rows
--      that will be removed.
--   2. Removes duplicate SharpAPI DraftKings/Circa history observations,
--      keeping the earliest inserted row for each provider source timestamp.
--   3. Adds a partial unique index enforcing one canonical row per true
--      provider history observation.
--   4. Adds a lookup index for incremental history collection.
--
-- IMPORTANT:
--   This migration deletes duplicate rows only for:
--     provider='sharpapi'
--     source_book IN ('draftkings','circa')
--     source_observed_at IS NOT NULL
--
--   Review the duplicate audit before applying. After applying, preserve
--   market_split_observations_v2_v30_duplicate_backup as the safety copy.

BEGIN;

CREATE TABLE IF NOT EXISTS market_split_observations_v2_v30_duplicate_backup AS
SELECT
  m.*,
  now()::timestamptz AS v30_backed_up_at,
  'sharpapi_history_duplicate'::text AS v30_reason
FROM market_split_observations_v2 m
WHERE false;

CREATE UNIQUE INDEX IF NOT EXISTS market_split_observations_v2_v30_duplicate_backup_id_uidx
  ON market_split_observations_v2_v30_duplicate_backup (id);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        provider,
        source_book,
        canonical_event_id,
        canonical_market_id,
        selection_key,
        source_observed_at
      ORDER BY inserted_at ASC, fetched_at ASC, id ASC
    ) AS rn
  FROM market_split_observations_v2
  WHERE provider = 'sharpapi'
    AND source_book IN ('draftkings', 'circa')
    AND source_observed_at IS NOT NULL
),
backed_up AS (
  INSERT INTO market_split_observations_v2_v30_duplicate_backup
  SELECT
    m.*,
    now()::timestamptz AS v30_backed_up_at,
    'sharpapi_history_duplicate'::text AS v30_reason
  FROM market_split_observations_v2 m
  JOIN ranked r ON r.id = m.id
  WHERE r.rn > 1
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
DELETE FROM market_split_observations_v2 m
USING backed_up b
WHERE m.id = b.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM market_split_observations_v2_v30_duplicate_backup
    WHERE v30_reason = 'sharpapi_history_duplicate'
      AND source_observed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'V30 backup contains a targeted row with null source_observed_at';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        provider,
        source_book,
        canonical_event_id,
        canonical_market_id,
        selection_key,
        source_observed_at,
        count(*) AS rows
      FROM market_split_observations_v2
      WHERE provider = 'sharpapi'
        AND source_book IN ('draftkings', 'circa')
        AND source_observed_at IS NOT NULL
      GROUP BY 1,2,3,4,5,6
      HAVING count(*) > 1
    ) d
  ) THEN
    RAISE EXCEPTION 'V30 duplicate SharpAPI history identities remain after delete; aborting before unique index';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS market_split_observations_v2_sharp_history_source_uidx
  ON market_split_observations_v2 (
    provider,
    source_book,
    canonical_event_id,
    canonical_market_id,
    selection_key,
    source_observed_at
  )
  WHERE provider = 'sharpapi'
    AND source_book IN ('draftkings', 'circa')
    AND source_observed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_split_observations_v2_sharp_history_latest_idx
  ON market_split_observations_v2 (
    canonical_event_id,
    source_book,
    source_observed_at DESC
  )
  WHERE provider = 'sharpapi'
    AND source_book IN ('draftkings', 'circa')
    AND source_observed_at IS NOT NULL;

COMMIT;

-- Optional post-apply verification queries:
--
-- Backup row count:
-- SELECT count(*) AS backed_up_rows
-- FROM market_split_observations_v2_v30_duplicate_backup
-- WHERE v30_reason = 'sharpapi_history_duplicate';
--
-- Confirm targeted backup rows all had source_observed_at:
-- SELECT count(*) FILTER (WHERE source_observed_at IS NULL) AS null_source_observed_at_rows
-- FROM market_split_observations_v2_v30_duplicate_backup
-- WHERE v30_reason = 'sharpapi_history_duplicate';
--
-- Confirm no duplicate SharpAPI history identities remain:
-- SELECT count(*) AS duplicate_identity_groups
-- FROM (
--   SELECT
--     provider,
--     source_book,
--     canonical_event_id,
--     canonical_market_id,
--     selection_key,
--     source_observed_at,
--     count(*) AS rows
--   FROM market_split_observations_v2
--   WHERE provider = 'sharpapi'
--     AND source_book IN ('draftkings', 'circa')
--     AND source_observed_at IS NOT NULL
--   GROUP BY 1,2,3,4,5,6
--   HAVING count(*) > 1
-- ) d;
