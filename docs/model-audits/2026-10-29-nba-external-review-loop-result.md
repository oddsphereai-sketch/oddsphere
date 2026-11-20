# NBA external-review and experiment loop result

Date: 2026-10-29

Status: completed offline audit. No live model, market reader, score,
probability, pick, grade, stake, lock, board, writer, or persisted-shadow row
was changed.

## Bottom line

The current aggregate independent-score foundation is reproducible and
reasonably calibrated, but the audit did not find a safe practical improvement
from residual context or Four Factors. Every candidate was rejected under its
predeclared gates. The live release remains unchanged.

The next credible accuracy source is a genuine timestamp-valid player
availability and expected-rotation ledger, followed by a new chronological
comparison against the complete current independent baseline. The market
reader must then be evaluated separately on exact forward locked evidence.

## Frozen scope

- base commit: `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`;
- live model / prediction-record release at audit start:
  `nba_professional_unified_2026_10_29_r24_consumer_execution_authority`;
- market marriage:
  `nba_market_marriage_2026_10_29_r25_consumer_execution_authority`;
- grade policy:
  `nba_grade_policy_2026_10_29_r15_consumer_execution_authority`;
- portable independent artifact:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`;
- feature release:
  `nba_point_in_time_features_2026_10_15_r13_season_regime_state`.

The compact historical ledger contains 6,152 point-in-time regular-season
games from 2021 through 2025. Its materialized SHA-256 is
`1d5b8f861950c83acfc7b4442e221cceb15c31754f41da12721f9a6f03b3449c`.
The materializer makes no provider calls or database writes.

## Rebuilt incumbent performance

The artifact recipe was refit inside each chronological fold. The deployed
full-history artifact was not scored backward.

| Test season | Team-score MAE | Margin MAE | Total MAE | Winner accuracy | Winner Brier | Margin slope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023 | 9.376 | 10.974 | 14.948 | 64.91% | 0.2117 | 1.136 |
| 2024 | 9.285 | 11.032 | 14.862 | 66.86% | 0.2096 | 1.140 |
| 2025 opened replication baseline | 9.562 | 11.371 | 15.224 | 68.13% | 0.2055 | 1.117 |

On pooled 2023-24, the incumbent produced 9.330 team-score MAE, 11.003 margin
MAE, 14.905 Total MAE, 65.88% winner accuracy, 0.2106 Brier, and an
actual-on-predicted margin slope of 1.134.

The slope indicates mild mean-margin compression. The much larger realized
margin dispersion than predicted-mean dispersion is not itself proof of a
forecast defect because game outcome noise belongs in the predictive
distribution, not the conditional mean.

## Experiments and independent review

### r1 residual sensitivity

A broad bounded residual diagnostic tested season-stage, rating-shape,
form/volatility, pace, schedule, and nominal rotation groups. No candidate
passed. The closest pace candidate improved only hundredths of a point and was
unstable across seasons.

External review correctly found that:

- the labeled drop-one variants were residual-head omissions, not base-model
  drop refits;
- compact bootstrap rotation fields were invalid because it contains two team
  aggregates per game, not player history;
- candidate distribution scale was estimated too optimistically;
- cohorts did not match the predeclaration;
- 2025 had already been opened and could not be treated as pristine.

Those findings caused r1 to remain diagnostic only.

### r2 Four Factors disagreement edges

The first r2 run appeared to improve every pooled metric, but external review
found eight undeclared duplicate missingness indicators and an iid-game
bootstrap. The result was not promoted.

The predeclared robustness repair used exactly eight continuous features, no
new indicators, one alpha, and a season-stratified calendar-week bootstrap.

| Metric | Candidate minus incumbent | 95% block interval |
| --- | ---: | ---: |
| Team-score MAE | -0.0091 | [-0.0215, +0.0037] |
| Margin MAE | -0.0044 | [-0.0336, +0.0242] |
| Total MAE | -0.0201 | [-0.0426, +0.0039] |

Winner accuracy rose 0.53 percentage points, but Brier worsened by 0.000054.
The team-score gain was under one hundredth of a point versus the required
0.10, and every error interval crossed zero. The disagreement-edge formulation
was retired and 2025 outcomes were not scored.

### r3 expected, possession-scaled Four Factors

Reviewers disagreed on whether one semantically distinct final experiment was
justified. It was allowed under a strict stop rule because r2 measured offense-
defense disagreement rather than the expected factor level. r3 blended offense
and opponent allowed/forced rates separately, formed expected matchup rates,
applied the correct turnover direction, and scaled by expected possessions.

| Metric | Candidate minus incumbent | 95% block interval |
| --- | ---: | ---: |
| Team-score MAE | -0.0003 | [-0.0126, +0.0111] |
| Margin MAE | -0.0016 | [-0.0181, +0.0151] |
| Total MAE | +0.0025 | [-0.0207, +0.0250] |

Winner accuracy declined 0.04 percentage points, Brier worsened slightly, and
the candidate failed the team-score, Total, Brier, and per-season gates. Both
external reviewers confirmed that the result is a genuine null. Aggregate Four
Factors are now exhausted for this audit. 2025 outcomes were not scored.

## Current full-product boundary

These experiments validate the portable aggregate base score head only. The
live independent path also applies roster-regime r2, and the unified product
then applies the qualified market reader. Therefore the numbers above must not
be described as final-card or betting accuracy.

The current roster-regime runtime uses static prior-season player profiles,
current active rosters, exact reported OUT exclusions, a 65% retained-minutes
activation threshold, and a 55% winner-confirmation threshold. Its checked-in
release record reports small historical improvements, but the repository does
not include the immutable historical injury/roster ledger or training operator
needed to reproduce that validation end to end. Historical game participation
must be proven to come only from earlier games, never the target game.

The current market reader cannot be faithfully validated from historical
consensus open/close data. Production uses exact target-excluded same-book
trails, splits, resistance, reversals, and buyback states. Those require exact
decision-time forward evidence. At audit time, the current r24 release had no
settled forward rows, so no current-release accuracy claim is made.

## Decision

- Live NBA behavior: unchanged.
- Promoted candidate: none.
- 2025 candidate replication opened: no.
- Aggregate feature work: stopped under the predeclared rule.
- Next work: the immutable player-state ledger and first experiment specified
  in `2026-10-29-nba-player-state-ledger-r1-predeclaration.md`.
- Reader work: evaluate only after an independent challenger passes, using the
  same exact forward locked rows and separate correction/harm, flip,
  promotion/demotion, exact-price, and board-count ledgers.

This is a useful result: it prevents a tiny retrospective change from being
mistaken for improvement and identifies the concrete missing evidence needed
for the next material accuracy step.

## Reproducible offline report hashes

- r1 residual sensitivity:
  `79a15e01443ffa4a84e93d38ad8ccb55424aa7f764bd65d377214c28446df355`;
- original r2 diagnostic:
  `6ee02865289bcaf90788cbc8299760b60ab7c29922b0daf11beda69cf9725e24`;
- corrected r2 robustness:
  `399c4fe5780789ae2e9db9e5af247914b067ac9921ebb4b3f8f76449a2dbab40`;
- final r3 expected Four Factors:
  `333847092b8ec4ea2522583333578e27ad953c60d98b2e58c859e0473e7e3bf8`.

The reports are regenerated from the frozen feature ledger and checked-in
scripts; they are not production inputs.
