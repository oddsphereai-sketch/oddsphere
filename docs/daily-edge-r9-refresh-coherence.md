# MLB Daily Edge r9 — refresh coherence

Date: 2026-07-26

Decision release: `mlb_daily_edge_decision_2026_07_26_r9`

## Scope

This release changes no projection, probability head, side-selection rule,
flip/correction rule, grade threshold, promotion/demotion rule, stake, Total
policy, First Inning policy, or sportsbook priority.

It fixes publication coherence in the existing authoritative path:

1. `lineup_watch` refreshes lines, lineups, and unlocked model rows;
2. the same sport-scoped `prediction_pipeline` lease immediately invokes the
   existing `createPredictionRecords` writer;
3. only after that writer succeeds, the existing Daily Edge response snapshot
   is republished; and
4. the non-lock `pregame_sweep` follows the same writer-then-snapshot sequence.

Locked prediction records remain immutable. Republished locked cards are built
from their stored pre-lock evidence, never post-lock prices.

## Price-reference repair

The prediction price selector already rejected trusted-book rows older than 90
minutes. The line-movement selector did not, allowing a stale high-priority
book to determine movement while a different fresh trusted book determined the
stored price. r9 applies the same freshness and blocked-book contract to both
selectors and uses one selected row for a Total's current price and line.
When every trusted quote is stale, the current quote and movement direction are
unavailable rather than relabeling old data as current.

For an unlocked game, a missing fresh trusted moneyline or total price is a
writer coverage failure. The prior authoritative record is preserved, the
failed market is reported, and the cron does not publish a new reader snapshot.
Locked rows continue to render their immutable pre-lock substrate.

## Release and board impact

- Public calibration remains `mlb_public_calibration_v8_2026_07_25`.
- Rule bundle remains `mlb_daily_edge_rule_bundle_v10_2026_07_25`.
- Grade policy remains
  `mlb_public_grade_policy_v10_mid_price_ml_ladder_2026_07_25`.
- Decision release advances from r8 to r9.
- Tracking contract advances to
  `member_facing_lock_v3_refresh_coherent_writer_authority_2026_07_26`.

Rule-level promotions: 0.

Rule-level demotions: 0.

Expected board-count change from rules: 0. Unlocked cards may legitimately
change after publication because r9 applies the unchanged r8 rules to the
newest coherent prediction/price/evidence tuple instead of a stale tuple.

## Load and failure behavior

No provider call, cron, timer, independent writer, or lease is added. Each
existing MLB lineup/pregame run performs at most one existing
`createPredictionRecords` pass and one response-snapshot publication. A record
sync failure prevents publication of a partially coherent new snapshot and
preserves the last coherent snapshot.

## Verification

Before deployment:

- `npm run verify:model-change`
- focused prediction-record writer tests
- refresh-cycle/pregame tests
- TypeScript typecheck
- production build
- read-only current-slate health and reader-coherence audits

After deployment, verify the r9 release stamp, one shared lease, no overlapping
writer, current unlocked record timestamps, locked-card fidelity, snapshot
freshness, board counts, and site responsiveness.
