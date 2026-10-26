# NFL nuanced market reader — result

Date: 2026-10-26  
Status: qualified future-unlocked production release

## Decision

Promote the side-market interpretation repair for new unlocked and future T-60 payloads. The
existing unified forecast remains authoritative first. The categorical side reader then operates
only on the shared Moneyline/Spread margin axis; it cannot replace or re-grade the independently
qualified Total axis.

The new authority route is deliberately conjunctive rather than a one-number trigger. It requires:

1. a persistent, unreversed named-book Moneyline price direction;
2. no opposing fresh money-minus-ticket flow;
3. at least one independent fresh flow in the same direction;
4. target-excluded no-vig Moneyline consensus on that same side; and
5. target-excluded Spread consensus on that same side.

When that evidence crosses the outright 50% boundary, it may correct the projected winner. When it
does not cross the outright boundary but contradicts the model's cover side, it is value resistance:
the winner is preserved, the margin may move toward the target-excluded Spread boundary, and an
opposed actionable Moneyline or Spread is demoted. This is not blind line following and it is not a
scalar market weight.

## Settled replay

The read-only replay used 59 checksum-matched settled production snapshots. All 59 had a score
projection; 40 had a published complete exact-price decision tuple and 19 were held. The candidate
was developed on the first 28 published rows and then checked on the later 12 published rows. The
replay made no writes and never mutated a stored lock.

| Metric | r39 baseline | r40 candidate |
| --- | ---: | ---: |
| Moneyline direction | 32-26-1 (55.17%) | 33-25-1 (56.90%) |
| Spread direction | 19-38-2 (33.33%) | 21-36-2 (36.84%) |
| Spread +3 | 28-29-2 (49.12%) | 30-27-2 (52.63%) |
| Spread +6 | 37-22 (62.71%) | 39-20 (66.10%) |
| Total direction | 37-22 (62.71%) | 37-22 (62.71%) |
| Team-score MAE | 6.7750 | 6.6321 |
| Margin MAE | 9.5589 | 9.2732 |
| Total MAE | 9.4960 | 9.4960 |
| All published actionables | 22-22, -1.58u | 22-14, +6.15u |

The changed-side ledger contains one Moneyline correction and two Spread corrections with zero
wrong-way side changes. Total has zero changed projections, sides, grades, promotions, or demotions.

Board size changes from 44 to 36 actionables across 120 published market decisions. Eight opposed
actionables are demoted: six losses and two wins. This is selective rather than a cap; the remaining
candidate board is 22-14. The grade policy retains a symmetric, tested promotion path for an aligned
positive-EV Spread Watchlist when the qualified margin correction makes it actionable. It simply did
not manufacture a promotion in this settled sample.

The chronology check also improves after the development window:

- selection (28 games): actionables 18-16, +0.71u -> 16-12, +2.80u;
- later confirmation (12 games): actionables 4-6, -2.29u -> 6-2, +3.34u;
- later confirmation side changes: one Moneyline and two Spread corrections, zero harms.

These are finite historical results, not a guarantee of future accuracy. They establish that the
repair is directionally better on the available release-pure evidence and does not purchase those
gains by changing Total or flattening the board.

## Defect reproductions

- `SF@ATL`: the r39 score favored San Francisco by 7.87 despite persistent Circa/Pinnacle movement
  and flow toward Atlanta. The candidate keeps San Francisco as the outright winner but moves the
  margin to San Francisco by 1.25, selects Atlanta +2.5 as a Watchlist side, and removes the losing
  San Francisco Moneyline/Spread Best Angles.
- `CIN@BAL`: named price history, independent flow, target-excluded Moneyline consensus, and
  target-excluded Spread consensus all selected Cincinnati. The candidate corrects the outright
  winner and Spread side. The stored r39 Baltimore lock remains immutable.

## Release and continuity

- model / calibration / decision / grade / member:
  `nfl_v1_daily_edge_model_2026_10_26_r32_nuanced_market_reader` /
  `nfl_v1_daily_edge_calibration_2026_10_26_r31_nuanced_market_reader` /
  `nfl_v1_daily_edge_decision_2026_10_26_r40_nuanced_market_reader` /
  `nfl_v1_grade_policy_2026_10_26_r40_nuanced_market_reader` /
  `nfl_v1_member_release_2026_10_26_r37_nuanced_market_reader`;
- Spread / target-exclusion / three-state reader:
  `nfl_v1_spread_market_direction_2026_10_26_r19_nuanced_market_reader` /
  `nfl_target_excluded_market_outcome_2026_10_26_r18_nuanced_market_reader` /
  `nfl_three_state_market_reader_2026_10_26_r3_cross_market_consensus`;
- writer / fixture / snapshot:
  `nfl_forward_evidence_writer_2026_10_26_r69_nuanced_market_reader` /
  `nfl_weekly_member_fixture_2026_10_26_r52_nuanced_market_reader` /
  `nfl_forward_member_snapshot_2026_10_26_r44_nuanced_market_reader`.

The r39/r36/r51/r43 unified-Total tuple remains the immediate read-only predecessor. Existing locks
render their exact stored payload before any current semantics. The sole writer and shared
`prediction_pipeline:nfl` lease remain unchanged.

## Rollback

Rollback restores the r39 unified-Total release tuple for future unlocked rows. Never rewrite,
reconstruct, or suppress an r40 or earlier locked payload.
