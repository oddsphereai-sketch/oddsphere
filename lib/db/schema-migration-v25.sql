-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V25 — Dual-source public splits observation layer
-- (Provider-separated public betting/money %; foundation for resolved read)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  PROPOSAL ONLY — DO NOT APPLY UNTIL EXPLICITLY APPROVED BY THE OPERATOR.
--
-- This file is the documented migration for the operator to review BEFORE
-- running it. Apply via the production apply plan at the bottom.
--
-- WHY
--   Public splits currently live in a SINGLE shared lane (sharp_signals.
--   public_betting_pct / public_money_pct) that holds EITHER SharpAPI (MLB)
--   OR Playbook (WNBA) — never both — so the two providers cannot be compared.
--   The dual-source architecture (docs/ODDSPHERE_DUAL_SOURCE_PUBLIC_SPLITS_ARCH.md)
--   needs a provider-SEPARATED observation layer so a resolved read can prefer
--   Playbook for display, keep SharpAPI as the comparison/confirmation point,
--   and turn provider agreement/disagreement into a model-confidence modifier.
--
-- WHAT (additive only)
--   New table:
--     public_splits_observations — one CURRENT row per
--       (provider, game_id, market_type, side); upsert on the unique key.
--   NO changes to sharp_signals / sharp_signals_history / lines / grades /
--   model. Public splits keep flowing through sharp_signals exactly as today;
--   this table is written ALONGSIDE (Phase 1 dual-write) and is not yet read
--   by any UI/grade path (Phase 2/3 wire the resolved read behind gates).
--
-- SAFETY
--   • Additive only. One new CREATE TABLE; zero ALTERs on existing tables.
--     No change to existing rows, cron behavior, lock logic, prediction,
--     grading, or tracking. If this table stays empty, nothing changes.
--   • Idempotent: CREATE TABLE IF NOT EXISTS; writers upsert on the unique key.
--   • Rollback at the bottom (pure DROP TABLE).
--
-- RETENTION
--   Current-row-per-provider/key (upsert) — bounded by slate size, not append.
--   A separate history/last-known-good table can mirror sharp_signals_history
--   in a later phase if cross-provider LKG is needed; not required for v1.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public_splits_observations (
  id                  BIGSERIAL PRIMARY KEY,
  provider            TEXT NOT NULL,
  sport               TEXT NOT NULL,
  game_id             BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market_type         TEXT NOT NULL,            -- moneyline | total | spread
  side                TEXT NOT NULL,            -- home | away | over | under
  public_betting_pct  DECIMAL(5,2),
  public_money_pct    DECIMAL(5,2),
  books_used          INT,
  observed_at         TIMESTAMPTZ NOT NULL,     -- provider fetch/compute time (freshness basis)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT public_splits_observations_provider_chk
    CHECK (provider IN ('playbook', 'sharpapi')),
  CONSTRAINT public_splits_observations_key
    UNIQUE (provider, game_id, market_type, side)
);

COMMENT ON TABLE public_splits_observations IS
  'Provider-separated public betting/money % observations (playbook|sharpapi). '
  'One current row per (provider, game, market, side); upsert on the unique key. '
  'Additive lane: written alongside sharp_signals, NOT a grade/model input until '
  'the resolved read + confidence modifier land under their own gated tickets. '
  'Playbook rows carry ONLY bet%/money%/books_used — never EV/fair/steam/RLM/CLV.';

CREATE INDEX IF NOT EXISTS public_splits_observations_game_idx
  ON public_splits_observations (game_id, market_type, side);

CREATE INDEX IF NOT EXISTS public_splits_observations_observed_idx
  ON public_splits_observations (observed_at DESC);

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed) — pure table drop; no existing tables/columns touched.
--   DROP TABLE IF EXISTS public_splits_observations;
-- ═════════════════════════════════════════════════════════════════════════════
-- END APPLY BLOCK
-- ═════════════════════════════════════════════════════════════════════════════
