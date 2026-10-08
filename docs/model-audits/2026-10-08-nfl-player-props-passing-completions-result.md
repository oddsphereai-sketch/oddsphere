# NFL Player Props independent Passing Completions result

Date: 2026-10-08  
Starting production base: `1240e7ee3d1fd2544f227ee4c5a4d365b333af3e`  
Decision: qualified for release

## Release decision

Promote the frozen `full_external__attempt_weighted__blend_75` Passing Completions point head and
its `empirical_global__mix_50__identity` probability release. The point forecast is 25% of the
preceding independent completion head plus 75% of a market-free team pass budget × expected lead
passer share × completion-rate model. Completions are capped at the independently forecast attempts.

The model uses shifted player, team, opponent, pressure, PFR, FTN, NGS, depth, weather, and verified
availability features. It contains no prop line, price, book, consensus, movement, or market
probability. Target-book-excluded market observations remain downstream: they measure disagreement,
edge, exact-price economics, and movement support, but cannot rewrite the independent point or
probability.

## Chronological point evidence

| Window | Reference MAE / RMSE | Candidate MAE / RMSE | Candidate bias |
| --- | ---: | ---: | ---: |
| 2024 selection (464 rows) | 5.58747 / 7.23555 | **4.85736 / 6.18458** | -0.04543 |
| 2025 confirmation (490 rows) | 5.56604 / 7.24089 | **4.62161 / 5.97321** | +0.37066 |

The 2025 candidate-minus-reference MAE delta is `-0.94443`. A 10,000-draw game-clustered
bootstrap gives a 95% interval of `[-1.23880, -0.66585]`. Every frozen chronological segment
improves: Weeks 1-4 `-1.26861`, Weeks 5-9 `-1.09063`, Weeks 10-13 `-0.99269`, and Weeks 14-18
`-0.52446` completions of MAE.

## Threshold probability evidence

The 2025 opening archive is checksum-pinned at
`ecb29183650dcc5a7814f7057c6cceb0c1249a131284d396608a7fc9be59de33`: 272 games, 2,203 paired
book offers, and 862 unique Passing Completions thresholds. Selection used expanding out-of-fold
blocks over 513 non-push observations.

| Metric | Reference | Candidate |
| --- | ---: | ---: |
| Brier | 0.25887 | **0.24973** |
| Log loss | 0.72406 | **0.69365** |
| Direction | 54.19% | **55.36%** |

Brier improves in all four chronological blocks: Weeks 7-9 `0.27563→0.26053`, Weeks 10-12
`0.26076→0.24999`, Weeks 13-15 `0.26159→0.25308`, and Weeks 16-18 `0.23978→0.23663`.

## Opened 2026 diagnostic

The exact immutable Weeks 1-4 replay has only six Passing Completions scopes and therefore is not
selection evidence. It does not reverse the historical result:

- point MAE/RMSE improves `12.32575/14.91756→7.28500/8.11308`;
- point direction improves `16.67%→33.33%`;
- Brier improves `0.57443→0.43745`; and
- log loss improves `1.72505→1.12775`.

The replay read all stored locks without mutation, reconstruction, or reinterpretation.

## Same-input current-board impact

The frozen Week 5 comparison uses 760 matched rows and zero provider calls. All seven other market
families are byte-identical across point projection, raw probability, market reading, final
probability, and grade. Passing Completions changes all 34 rows, changes two grades from No Play to
Watchlist, and has zero actionable promotions and zero actionable demotions. The 12-actionable
full board is therefore unchanged and not flattened. Passing Yards explicitly consumes the prior
completion foundation so this market-scoped release cannot alter its workload calculation.

## External-research alignment

The decomposition follows nflfastR's public completion-probability work and the tracking literature:
completion likelihood is distinct from pass volume and responds to target depth, pressure/hits,
throw context, environment, and passer history. NFL Next Gen Stats supplies the public historical
expected-completion/CPOE inputs; no unavailable assignment-level receiver/defender geometry is
invented.

- <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- <https://github.com/nflverse/nflfastR>
- <https://arxiv.org/abs/2109.08051>
- <https://operations.nfl.com/gameday/technology/nfl-next-gen-stats>

## Production boundary and rollback

The release family is portable/model/calibration/decision/runtime/board/member/lifecycle/writer/
tracking `r10/r19/r21/r24/r25/r28/r36/r19/r42/r24`, named
`independent_passing_completions`. The expected-role artifact is
`nfl_player_props_expected_role_runtime_2026_10_08_r2_passing_completions`.

The sole `nflPlayerPropsProductionWriter`, shared `prediction_pipeline:nfl` lease, cadence, provider
calls and ceilings, exact-price selection, grade thresholds, stakes, settlement, copy, labels, and
layout are unchanged. Ordinary unlocked rows are freshly recomputed. Every previously locked row
retains its exact stored release and payload. Roll back the complete Passing Completions family to
the October 8 independent Passing Attempts release without rewriting locks if coherence, coverage,
writer, reader, or live-release verification fails.
