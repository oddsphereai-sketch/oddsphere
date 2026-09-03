# WNBA v1.4 single-market-entry candidate result

Date: 2026-09-03 ET

Integrated base: `e81feab16d5215f89b83dd39159581cd185af094`

Predeclaration commits:

- `73da97b5` (single-market-entry predeclaration)
- `d86d2d93` (cross-market contradiction addendum)

Status: authoritative production candidate; structural qualification only, not a predictive-lift claim.

## Implemented contract

The target-excluded Moneyline probability no longer enters a cold-start team's
rating and then enters again through the dynamic Moneyline blend. The incumbent
cold-start prior remains the default private-calculator behavior; the authoritative
qualified-market call disables only that duplicate path. The existing dynamic
market reliability, disagreement and conflict logic is otherwise unchanged.

The frozen addendum is also implemented. The evaluated Moneyline and Spread
targets are selected from the independent distribution before inference. If both
target-excluded markets qualify but their Moneyline plurality and Spread winner or
25/75 desired-mean regimes contradict, all market forecast authority is rejected.
The final distribution then exactly equals the independent sport distribution.
Named evaluated pairs remain available downstream for exact break-even, expected
return and grade economics.

The final margin distribution supplies Moneyline sign mass and every Spread CDF
probability. Its mean supplies the algebraic decimal score margin. Total remains
the independent Total normal and the two displayed scores sum exactly to that
mean. Missing, singleton, correlated, stale, skewed and contradictory optional
evidence never produces Hold or 0.5.

## Frozen synthetic results

The focused cold-start fixture has independent home probability
`0.8272883253628827`, independent margin `14.835999999999999`, independent Total
`165`, and decimal scores `89.918` to `75.082`.

- Compatible qualified home-favorite evidence enters once and produces home
  probability `0.7058867566054783`, margin `10.084`, Total `165`, and aligned
  publication-side semantics.
- Compatible qualified opposing evidence legitimately flips the independent home
  side to final home probability `0.422218077866377`; the exact complementary side
  is repriced from the already-fixed complete evaluated pair.
- The adversarial ML-home/Spread-away regime is classified
  `cross_market_contradictory_independent_fallback` and returns the exact
  independent probability, margin, Total and decimal scores above.
- The positive exact-price three-market fixture has board counts
  `Best Angle=3, Lean=0, Watchlist=0, Caution=0`.
- Changing only the evaluated Spread/Total quotes to negative-EV prices preserves
  every forecast and changes board counts to
  `Best Angle=1, Lean=0, Watchlist=2, Caution=0`; this is two tested demotions with
  no side change. The corresponding positive-price state supplies the promotion
  paths without a quota.

These are structural fixtures, not outcome evidence and not a natural-board
impact claim.

## Authentic live monitor

The unchanged release-pure v1.3 read-only monitor ran at
`2026-09-03T13:32:16.430Z` with zero provider calls, zero cron calls and zero
writes. For the database-known `2026-09-03` through `2026-09-17` window it found:

- scheduled games: `0`
- current prediction records: `0`
- current v1.3 records: `0`
- current v1.3 forward-capture rows: `0`
- eligible locked and settled release-pure rows: `0`

Accordingly all natural ML/Spread/Total board counts are zero, natural projection,
side and grade deltas are unavailable, and no proper-score, upset-recall, ROI or
qualification claim is made. The monitor result remains
`not_ready_zero_eligible_release_pure_settled_capture_rows`.

## Release and persistence checks

- Model: `wnba_v1_4_single_market_entry`
- Distribution: `wnba_single_market_entry_2026_09_03_v6`
- Calibration schema: `wnba_core_calibration_v4_single_market_entry`
- Grade policy: `wnba_grade_policy_v9_single_market_entry_2026_09_03`
- Decision tuple: `wnba_decision_tuple_v4_single_market_entry_2026_09_03`
- Prediction record: `wnba_prediction_record_contract_v6_single_market_entry_2026_09_03`
- Forward action evidence: contract/key v3, release-pure reset

Calibration formulas and all six runtime flags are regression-asserted unchanged.
The target-excluded decision and behavior-neutral forward-capture contracts are
unchanged. The sole `runWnbaModel` writer, shared `prediction_pipeline:wnba` lease,
provider/query/write load, tracking ownership and lock skip remain unchanged.
Reader tests prove exact locked v1 and v1.3 tuple precedence after the v1.4 bump.

## Verification

Passed:

- `npm run preverify:model-change`
- WNBA target-excluded/single-entry and cross-market fallback test
- WNBA core calibration: `78 passed, 0 failed`
- WNBA forward evidence capture
- WNBA action-promotion evidence
- WNBA incoherent-total/current-v6/locked-v1+v3 reader regression
- WNBA daily-refresh telemetry
- WNBA price trail: `8/8`
- WNBA final-score ingest: `4/4`
- prediction-record service: `380/380`
- cron lease retry and immediate-market champion tests
- ESLint on every changed TypeScript file
- `git diff --check`

The fresh integration also updates the immutable WNBA literals in the shared MLB
pipeline-safety and Daily Edge reader tests and records v1.4/v6/v9 in
`docs/current-model-releases.md`. TypeScript, the full model-change gate and the
production build are rerun on the exact integrated tree before publication.

## Production and post-deployment gate

Deterministic structural gates establish both legitimate promotion and demotion
paths without quotas and exact independent fallback for contradictory or
insufficient evidence. The empty natural board is not treated as evidence and
does not establish predictive improvement. After protected publication, the
automatic first-real-slate monitor must verify release-pure target/evidence
coverage, coherent decimal outputs, natural side and grade deltas, and eventual
proper scores and profitability separately.
