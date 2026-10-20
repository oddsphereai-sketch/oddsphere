# NBA independent-margin compression repair result

Date: 2026-10-20

Status: prospective shadow accepted; production promotion rejected. Public NBA
scores, picks, probabilities, grades, stakes, locks, tracking authority, and
member output remain on the existing r9/r6 production family.

## What was actually compressed

The incumbent 2025 confirmation forecasts had a 1.1165 zero-intercept margin
calibration slope. A slope above 1.0 means realized margins increased faster
than the model's expected margins, which is evidence of regression toward the
mean. The realized-margin standard deviation of 16.413 points is not itself a
valid target for pregame mean forecasts because it also contains irreducible
within-game variance.

The primary audit therefore optimized chronological forecast accuracy and
calibration, not cosmetic width. It compared ridge penalties, adjusted-rating
margin and Total contributions, and train-only slope calibration. Selection
used rolling 2022-2024 origins; 2025 was opened once for confirmation.

## Selected recipe

The frozen selection chose:

- ratings-and-schedule ridge alpha 300, replacing alpha 1,000 in the shadow;
- 30% adjusted-rating contribution to margin;
- 20% adjusted-rating contribution to Total; and
- no post-fit scalar widening.

The absence of a selected slope multiplier is important: the data preferred a
less-shrunk matchup model plus rating diversity, not a rule that simply makes
every favorite look stronger.

## 2025 confirmation

| Metric | Incumbent | Candidate | Result |
| --- | ---: | ---: | --- |
| Winner accuracy | 68.130% | 68.130% | identical |
| Winner Brier | 0.205080 | 0.203958 | improved |
| Team-score MAE | 9.5620 | 9.5432 | improved |
| Margin MAE | 11.3705 | 11.3247 | improved |
| Total MAE | 15.2235 | 15.2293 | +0.0058, inside tolerance |
| Predicted-margin SD | 6.879 | 7.366 | less compressed |
| Margin calibration slope | 1.1165 | 1.0526 | 54.9% less calibration error |
| Opening-Spread direction | 48.914% | 50.672% | improved, evaluation only |

On the incumbent's fixed 386-game under-three-point cohort, winner accuracy was
unchanged at 57.513% and margin MAE improved from 11.8505 to 11.7853. The
candidate failed only the predeclared production magnitude gate: its margin-MAE
gain was 0.0458 rather than at least 0.10 points. It therefore cannot replace
the public scorer from this retrospective test.

## Rejected alternatives

- Direct train-only slope widening was not selected.
- The nonlinear challenger failed rolling-origin stability despite an enticing
  final-season winner result; its margin and Total MAE were both worse.
- Targeted historical player-impact and rotation-summary feature groups did not
  beat the base feature family in selection. Those fields infer rotations from
  prior games and are not authentic archived pregame availability reports.

This isolates the remaining structural opportunity: timestamped pregame player
status plus expected-minutes/lineup state. It must be trained and tested as its
own point-in-time layer; current injury labels must not be backfilled into old
games or treated as known historical truth.

## Prospective shadow and board impact

`nba_independent_score_shadow_2026_10_20_r2_alpha300_rating_30_total_20`
scores the portable alpha-300 artifact, applies the frozen rating contributions,
and passes that independent score through its own target-book-excluded copy of
the production r6 market reader. It is stored only in the grounding audit with
`productionAuthority=false`.

The exact October 20 feature replay changed independent shadow margins as
follows before the reader:

| Game | Public independent margin | r2 shadow margin |
| --- | ---: | ---: |
| BOS at DET | BOS 0.478 | DET 0.254 |
| PHI at NY | NY 2.967 | NY 4.822 |
| OKC at SA | SA 0.342 | SA 1.347 |

Because this is a zero-authority shadow, public board impact is exactly zero:
zero score changes, zero side changes, zero promotions, zero demotions, and zero
actionable-count changes. Locked rows remain byte-for-byte authoritative.

## Prospective decision boundary

Promotion requires a new predeclaration after enough release-pure settled games
exist. It must compare public and r2 shadow on team-score MAE, margin MAE, Total
MAE, winner accuracy/Brier, main and +3/+6 Spread results, Total results,
underdog calls, reader-qualified cohorts, and board counts. Until then the r2
result is a measurable repair hypothesis, not a claim that the betting product
has already gained 1.76 percentage points against the Spread.

Rollback removes the r2 shadow artifact and returns capture to r1. It never
rewrites a locked or public prediction.
