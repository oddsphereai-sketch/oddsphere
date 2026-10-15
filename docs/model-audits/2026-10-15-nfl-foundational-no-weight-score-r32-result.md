# NFL foundational no-weight score r32 — result

Date: 2026-10-15

## Decision

Advance the r11 exact-provider independent score and the categorical no-weight market reader for
future unlocked NFL rows. The independent score never receives a sportsbook line, price, movement,
or split as a feature. The market layer records `marketWeight: 0` and may act only through named,
auditable rules after the independent score exists. Existing locked payloads remain authoritative
and byte-preserved.

## Architecture

- Margin: a frozen 96-tree Extra Trees regressor trained through the 2025 season.
- Total: an opponent-adjusted dynamic scoring state plus a bounded residual ensemble.
- Pregame football inputs: opponent-adjusted fast/slow offense and defense for explosive-play
  rate, sack rate, turnover rate, plays, red-zone touchdown rate, no-huddle rate, and points;
  rest, division, neutral-site, roof, surface, and current-season completed-game state.
- Runtime state uses only completed games before the prediction week. The current-season seed is
  complete through Week 5. Runtime parity against the Python exporter is below `8e-15` points.
- The independent runtime declares `marketInputPolicy: prohibited_from_independent_score`.
- The target-excluded reader either uses a complete stable tuple or returns the untouched
  independent forecast. It cannot use the evaluated sportsbook family as its own evidence.
- The market reader does no scalar blending. It permits only: separately qualified winner
  coherence, professional Spread direction, and qualified Total direction. A permitted directional
  correction reflects the independent distance across the evaluated boundary so the score,
  winner, margin, Total, and probabilities remain one coherent distribution.

## Frozen retrospective evidence

These results are opened retrospective evidence, not a promised future hit rate.

### Broad independent-score checks

- 2024-2025, 544 games: Moneyline 359-184-1 (66.11%), Spread 273-266-5 (50.65%),
  Spread +3 332-207-5 (61.60%), Spread +6 380-161-3 (70.24%).
- Exact-provider 2026 replay, 79 games: Moneyline 53-25-1 (67.95%), Spread 43-30-6
  (58.90%), Spread +3 55-24 (69.62%), Spread +6 61-18 (77.22%), margin MAE 9.698.
- The r10 Total check produced 10.347 MAE on 2024-2025 and 11.525 MAE on the complete
  exact-provider 2026 replay. Its independent direction alone is not promoted as a standalone
  betting edge; the target-excluded reader result below is the product candidate.

### Exact 32-game paid/evidence cohort

The final target-excluded, no-scalar-weight marriage records:

| Market | Result | Accuracy |
| --- | ---: | ---: |
| Moneyline | 23-8-1 | 74.19% |
| Spread | 18-11-3 | 62.07% |
| Spread +3 | 23-9 | 71.88% |
| Spread +6 | 25-7 | 78.13% |
| Total | 22-10 | 68.75% |
| Total +3 | 23-9 | 71.88% |
| Total +6 | 24-8 | 75.00% |

Margin MAE is 8.663 and final Total MAE is 9.105. The target-free reader is eligible for 23 games
and falls back to untouched independent output on 9. It makes zero Moneyline corrections, zero
professional Spread corrections, and 15 qualified Total corrections. Independent Total alone was
13-19 with 10.753 MAE; the target-free reader is 22-10 with 9.105 MAE. By contrast, the prior
wholesale market marriage reduced Moneyline from 23-8-1 to 18-13-1 and Spread from 18-11-3 to
14-15-3. That failure is the reason market evidence is no longer blended into the independent score.

Probability diagnostics on the final cohort are Moneyline Brier/log loss/calibration gap
0.21265/0.61342/+0.07939, Spread 0.23248/0.65756/+0.11796, and Total
0.22903/0.65057/-0.03873. Predicted Moneyline favorites are 17-7-1 and predicted underdogs 6-1.

## Competitor reference

The supplied NFL competitor screenshot reports season-to-date Moneyline 41-23 (64.1%), Spread
37-25 (59.7%), Spread +3 41-22 (65.1%), Spread +6 46-17 (73.0%), Total 32-32 (50.0%),
Total +3 36-28 (56.3%), and Total +6 39-25 (60.9%). The candidate percentage is higher in all
seven categories on the matched 32-game internal cohort. This is not a normalized head-to-head:
the competitor has 62-64 bets and the candidate has 29-32 resolved decisions, with different games,
prices, and selection timing. No superiority claim is made until both are scored on the same games.

## Current Week 6 zero-write rehearsal

The read/provider-only rehearsal covers 14 games and 42 markets and writes zero rows. The stored
baseline has 16 actionables (6 Moneyline, 5 Spread, 5 Total). The candidate has 17 (6, 6, 5), with
7 promotions and 6 demotions: Moneyline 2/2, Spread 5/4, Total 0/0. There are 16 side changes and
36 probability changes, so this is a material model replacement rather than a cosmetic threshold
change. Both versions hold two games.

`PIT@TB` is correctly held because Baker Mayfield is unavailable and the selected replacement has
no exact historical model identity. `WSH@SF` is correctly held because no verified exact-game injury
report has been published. The collector repair retains successful designation batches, serializes
provider batches, and falls back only unresolved games; it does not manufacture an unpublished
report. The local rehearsal used the configured sentinel rather than a live Playbook credential, so
Playbook split parity is not claimed.

## Release and safety contract

- Member/model/calibration/decision/grade: r32/r28/r27/r35/r35.
- Weekly outcome/distribution/probability/representative score: r16/r15/r15/r15.
- Market outcome/Spread/Total/target exclusion: r16/r16/r12/r14.
- Collector/writer/fixture/compact snapshot: r21/r62/r44/r36.
- One existing `prediction_pipeline:nfl` lease and one writer remain authoritative.
- Snapshot r35/member r31/decision r34/fixture r43 is the immediate immutable predecessor. Readers
  retain it and all earlier bounded predecessors. No stored lock is recalculated.

Rollback the complete r32 family to the r31 personnel family on mixed releases, incomplete current
state, runtime parity failure, unrecognized team state, board collapse, provider budget overrun,
reader/snapshot failure, writer overlap, or any difference in a previously locked payload.
