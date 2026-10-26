# NFL joint side-market arbitration — result

Date: 2026-10-26  
Status: qualified future-unlocked production release

## Decision

Promote the bounded joint side-market repair for new unlocked and future T-60 payloads. It fixes
two distinct reader defects without introducing a scalar market weight:

1. `confirmation` now requires the qualified sharp side to agree with both the projected outright
   winner and the projected cover. A winner/cover disagreement is handled at the Spread boundary.
2. An apparent named-book upset move is classified as cross-market resistance when fresh
   independent flow opposes that move and target-excluded Moneyline plus Spread consensus both
   remain on the favorite. This is not a favorite rule: all three pieces of evidence are required,
   and disagreement or missing evidence leaves the established forecast intact.

The unified forecast and Total are resolved before this side arbitration. Both routes operate only
on the shared margin axis; the Total side, projection, probability, grade, price, and units remain
byte-for-byte equivalent to the established result.

## Settled replay

The read-only replay used 59 checksum-matched settled production snapshots: 40 published complete
exact-price tuples and 19 held rows. It made no writes and did not mutate or reinterpret a lock.

| Metric | r40 live | r42 candidate |
| --- | ---: | ---: |
| Moneyline direction | 33-25-1 (56.90%) | 35-23-1 (60.34%) |
| Spread direction | 21-36-2 (36.84%) | 25-32-2 (43.86%) |
| Spread +3 | 30-27-2 (52.63%) | 33-25-1 (56.90%) |
| Spread +6 | 39-20 (66.10%) | 41-18 (69.49%) |
| Total direction | 37-22 (62.71%) | 37-22 (62.71%) |
| Team-score MAE | 6.6321 | 6.5154 |
| Margin MAE | 9.2732 | 8.9605 |
| Total MAE | 9.4960 | 9.4960 |
| Moneyline actionables | 2-4, -2.58u | 4-2, +0.98u |
| Spread actionables | 5-5, -0.25u | 9-3, +5.58u |
| Total actionables | 15-5, +8.98u | 15-5, +8.98u |
| All published actionables | 22-14, +6.15u | 28-10, +15.53u |

Board size increases from 36 to 38 actionables; the result is not produced by flattening the
board. The winner/cover portion also improves the later 12-game slice from 6-2 (+3.34u) to 7-2
(+4.32u). The cross-market resistance route is intentionally narrower: it appears in three
settled snapshots, all three correct the winner direction, and two published games change.

## Exact changed-game ledger

Relative to the winner/cover-only candidate, only two published games change:

- `CHI@ATL`: Atlanta Moneyline and +1.5 Spread losing Best Angles become Chicago Moneyline and
  -1 winning Best Angles; actual score Chicago 31, Atlanta 23.
- `NE@CHI`: New England Moneyline and +3 Spread losing Best Angles become Chicago Moneyline and
  -3 winning Best Angles; actual score New England 24, Chicago 30.

No published Total field changes in either game or anywhere else in the 59-game replay. The third
resistance occurrence is a held historical row, so it cannot manufacture an actionable result.

## Rejected broader rules

Blindly following a target-excluded favorite was rejected: the five historical disagreements were
only 3-2. Blindly following qualified professional Moneyline authority was also rejected: authority
opposing the independent model was 5-5. A more permissive named-price route that overrode opposing
fresh flow created wrong-way changes and no later-slice improvement. The released route therefore
requires the specific conjunction of opposing fresh flow and target-excluded Moneyline/Spread
resistance; it does not infer missing handle, bet size, limits, origin, or suspension behavior.

## Release and continuity

- model / calibration / decision / grade / member:
  `nfl_v1_daily_edge_model_2026_10_26_r34_joint_side_market_arbitration` /
  `nfl_v1_daily_edge_calibration_2026_10_26_r33_joint_side_market_arbitration` /
  `nfl_v1_daily_edge_decision_2026_10_26_r42_joint_side_market_arbitration` /
  `nfl_v1_grade_policy_2026_10_26_r42_joint_side_market_arbitration` /
  `nfl_v1_member_release_2026_10_26_r39_joint_side_market_arbitration`;
- Spread / target exclusion / three-state reader:
  `nfl_v1_spread_market_direction_2026_10_26_r21_joint_side_market_arbitration` /
  `nfl_target_excluded_market_outcome_2026_10_26_r20_joint_side_market_arbitration` /
  `nfl_three_state_market_reader_2026_10_26_r5_joint_side_market_arbitration`;
- writer / fixture / snapshot:
  `nfl_forward_evidence_writer_2026_10_26_r71_joint_side_market_arbitration` /
  `nfl_weekly_member_fixture_2026_10_26_r54_joint_side_market_arbitration` /
  `nfl_forward_member_snapshot_2026_10_26_r46_joint_side_market_arbitration`.

The r40/r37/r52/r44 tuple remains the immediate startup and immutable-reader predecessor. Existing
locks render their exact stored payload before current semantics. The sole writer and shared
`prediction_pipeline:nfl` lease are unchanged.

## Rollback

Rollback restores the r40 nuanced-reader tuple for future unlocked rows. Never rewrite,
reconstruct, suppress, or re-grade an r42 or earlier locked payload.
