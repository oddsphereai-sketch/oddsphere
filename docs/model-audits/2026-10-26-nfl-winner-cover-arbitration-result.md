# NFL winner/cover sharp arbitration — result

Date: 2026-10-26  
Status: qualified future-unlocked production release

## Decision

Promote the winner/cover arbitration repair for new unlocked and future T-60 payloads. The repair
fixes a concrete classification defect in the three-state side reader: agreement between the
qualified sharp side and the projected outright winner was previously labeled `confirmation` even
when that sharp side contradicted the independent projected cover side.

The reader now tests two distinct boundaries:

1. the outright winner boundary; and
2. the target-excluded market Spread boundary.

`confirmation` requires agreement on both. When the qualified sharp side agrees with the winner but
opposes the projected cover, the state is `value_resistance`. The reader may cross the Spread
boundary while preserving the outright winner. When the qualified sharp side opposes the winner,
an outright correction still requires the target-excluded Moneyline boundary to agree. Total is
resolved independently and remains exactly unchanged.

This remains a categorical evidence policy, not a scalar market weight or an instruction to follow
every move. Persistent named-book direction still requires independent confirming flow, rejects
opposing flow, and is recomputed after excluding the sportsbook families used by the candidate
decision.

## Settled replay

The read-only replay used 59 checksum-matched settled production snapshots: 40 published complete
exact-price tuples and 19 held rows. It made no writes and did not mutate or reinterpret a stored
lock.

| Metric | r40 live | r41 candidate |
| --- | ---: | ---: |
| Moneyline direction | 33-25-1 (56.90%) | 33-25-1 (56.90%) |
| Spread direction | 21-36-2 (36.84%) | 23-34-2 (40.35%) |
| Spread +3 | 30-27-2 (52.63%) | 31-26-2 (54.39%) |
| Spread +6 | 39-20 (66.10%) | 40-19 (67.80%) |
| Total direction | 37-22 (62.71%) | 37-22 (62.71%) |
| Team-score MAE | 6.6321 | 6.6181 |
| Margin MAE | 9.2732 | 9.2095 |
| Total MAE | 9.4960 | 9.4960 |
| Spread actionables | 5-5, -0.25u | 7-5, +1.65u |
| All published actionables | 22-14, +6.15u | 24-14, +8.05u |

The later 12-game confirmation slice improves Spread direction from 6-6 to 7-5, Spread actionables
from 2-0 to 3-0, and the whole published board from 6-2 (+3.34u) to 7-2 (+4.32u).

Against r40, three published rows change:

- `CLE@NYJ`: the projected winner remains New York, but the Spread changes from losing Cleveland
  +2.5 Watchlist to winning New York -2.5 Watchlist;
- `TEN@IND`: the winning Tennessee +6.5 side remains intact and moves from Watchlist to Lean after
  winner/cover coherence; and
- `KC@SEA`: the projected winner remains Seattle, while losing Kansas City +3 Watchlist changes to
  winning Seattle -3 Lean.

That ledger contains two corrected Spread sides, two winning promotions, no wrong-way changes, no
Moneyline side changes, and no Total projection, side, or grade changes. Board size increases from
36 to 38 actionables; this is not a flattening release.

## Broader-reader rejection

A more permissive candidate that let persistent named-book direction override opposing fresh flow
was rejected. Although it corrected some historical disagreements, it also introduced new wrong-way
changes and produced no net improvement in the later confirmation slice. Two agreeing named books
alone were also insufficient: the settled ledger contains both correct and incorrect two-book
directions. The retained opposing-flow veto is therefore evidence-backed rather than arbitrary
conservatism.

## Release and continuity

- model / calibration / decision / grade / member:
  `nfl_v1_daily_edge_model_2026_10_26_r33_winner_cover_arbitration` /
  `nfl_v1_daily_edge_calibration_2026_10_26_r32_winner_cover_arbitration` /
  `nfl_v1_daily_edge_decision_2026_10_26_r41_winner_cover_arbitration` /
  `nfl_v1_grade_policy_2026_10_26_r41_winner_cover_arbitration` /
  `nfl_v1_member_release_2026_10_26_r38_winner_cover_arbitration`;
- Spread / target-exclusion / three-state reader:
  `nfl_v1_spread_market_direction_2026_10_26_r20_winner_cover_arbitration` /
  `nfl_target_excluded_market_outcome_2026_10_26_r19_winner_cover_arbitration` /
  `nfl_three_state_market_reader_2026_10_26_r4_winner_cover_arbitration`;
- writer / fixture / snapshot:
  `nfl_forward_evidence_writer_2026_10_26_r70_winner_cover_arbitration` /
  `nfl_weekly_member_fixture_2026_10_26_r53_winner_cover_arbitration` /
  `nfl_forward_member_snapshot_2026_10_26_r45_winner_cover_arbitration`.

The r40/r37/r52/r44 tuple is the immediate startup and immutable-reader predecessor. Earlier
predecessor contracts remain accepted. Existing locks render their stored payload before current
semantics. The sole writer and shared `prediction_pipeline:nfl` lease are unchanged.

## Rollback

Rollback restores the r40 nuanced-reader tuple for future unlocked rows. Never rewrite,
reconstruct, suppress, or re-grade an r41 or earlier locked payload.
