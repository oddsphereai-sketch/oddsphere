# NFL player props market-selective mean-quintile release

Date: 2026-10-07  
Research base after required integration: `cb0eae69166c1077eee260acea36f92d3f27f083`  
Predeclaration: `docs/model-audits/2026-10-07-nfl-player-props-opportunity-budget-distribution-predeclaration.md`

## Decision

Promote mean-conditioned empirical residual quintiles for Passing Attempts,
Passing Yards, Rushing Attempts, Rushing Yards, and Receiving Yards. Keep the
incumbent four-bucket distributions for Passing Completions and Receptions.
Keep every point model, feature, role prior, target-book exclusion rule,
representative-line rule, grade threshold, price rule, stake, provider request,
schedule, writer, lease, and member-facing surface unchanged.

The full seven-market distribution candidate passed the frozen offline
distribution gate, but it failed the exact-board product gate. On the exact
settled Week 4 board it promoted three losing Passing Completions/Receptions
actions and removed two winning Receptions actions. Those two market
calibrations are therefore deferred rather than hidden inside an aggregate
gain. The five-market release preserves the stronger calibration evidence
without shipping those harmful decision transitions.

## Current production audit

The audited incumbent family was portable/model/calibration/decision/runtime/
board/member/lifecycle/writer/tracking r6/r15/r17/r20/r21/r24/r32/r15/r37/r20.
The end-to-end inspection found:

- Provider collection is bounded at slate level, uses the existing authoritative
  writer and `prediction_pipeline:nfl` lease, and has no per-card API loop. The
  production collection contract remains at a 51-call maximum; this release
  adds zero calls.
- Game/player identity and official settled outcomes were rebuilt from 60
  checksum-pinned 2016-2025 nflverse files: 138,860 player-game rows, 2,639
  games, 3,104 players, and 99.258438% outcome/roster identity coverage. The
  corrected-source feature checksum is
  `f80b1479ca27ddf91c256ff791bcd6dea1f435fd6248a95f1f63665b4c8cd8bd`.
- The incumbent point family already consumes player history, position and role,
  team/opponent volume and efficiency, pressure/sacks, explosive plays, air
  yards/YAC, weather/venue, official current-season overlays, expected-starter
  status, injuries, and target-book-excluded passing-market workload evidence.
- Exact offers are reduced to one canonical representative line per
  player/market. The evaluated book is excluded from its benchmark. Missing
  independent evidence is neutral and cannot manufacture a grade.
- Passing workload evidence is applied once in the independent point head;
  ordinary non-passing markets use the incumbent residual marriage; Receptions
  retains the already released qualifying disagreement arbitration. The
  displayed projection is inverted from the same selected residual family and
  probability that determines the side.
- T-60 state, exact price, line, probability, projection, grade, evidence, and
  tracking identity are lock-preserved. Production reconciliation now refuses
  to relabel any retained unlocked ordinary row under the new family; it must be
  freshly recomputed. Locked rows keep their exact stored payload.
- Settlement and CLV remain on the existing bounded-finality path. This release
  changes neither tracking semantics nor the reader layout/copy.

The official data contracts used for the research are documented by
[nflverse-data](https://github.com/nflverse/nflverse-data/blob/main/README.Rmd),
[nflreadr](https://github.com/nflverse/nflreadr), and the
[participation data dictionary](https://nflreadr.nflverse.com/articles/dictionary_participation.html).
Provider behavior was checked against the
[Ball Don't Lie API documentation](https://docs.balldontlie.io/).

## Chronological research results

The opportunity-budget architecture was evaluated first with training through
2022, selection in 2023, confirmation in 2024, and untouched 2025 holdout. No
candidate improved both MAE and RMSE in every required pre-holdout stage, so no
point head advanced. The retained 2025 point errors were:

| Market | MAE | RMSE |
| --- | ---: | ---: |
| Passing Attempts | 6.11562 | 9.44853 |
| Passing Completions | 4.01589 | 6.18518 |
| Passing Yards | 45.04526 | 70.48688 |
| Rushing Attempts | 2.14680 | 3.49265 |
| Rushing Yards | 11.99814 | 20.96610 |
| Receptions | 1.19757 | 1.71703 |
| Receiving Yards | 15.65236 | 23.56176 |

The second hypothesis conditioned each market's empirical residual distribution
on independent predicted-mean quintiles. It used 2023 calibration fit, 2024
selection/confirmation, and untouched 2025 holdout. All markets improved both
CRPS and NLL and passed the frozen 80%/90% coverage tolerances:

| Market | Holdout CRPS change | Holdout NLL change | Candidate 80% / 90% coverage | Clustered CRPS 95% CI | Release |
| --- | ---: | ---: | ---: | ---: | --- |
| Passing Attempts | -11.398% | -9.654% | 81.80% / 91.59% | [-0.5669, -0.4482] | promote |
| Passing Completions | -0.814% | -0.891% | 81.27% / 90.90% | [-0.0514, 0.0102] | defer after board replay |
| Passing Yards | -0.661% | -0.787% | 82.03% / 91.13% | [-0.4912, 0.1259] | promote |
| Rushing Attempts | -0.642% | -2.055% | 81.62% / 90.53% | [-0.0155, -0.0032] | promote |
| Rushing Yards | -0.648% | -1.490% | 80.78% / 88.81% | [-0.0834, -0.0234] | promote |
| Receptions | -0.525% | -0.670% | 81.86% / 90.28% | [-0.0063, -0.0026] | defer after board replay |
| Receiving Yards | -0.494% | -1.276% | 80.61% / 89.24% | [-0.0769, -0.0267] | promote |

The exported manifest proves every point-model object is byte-identical. The two
deferred market files are also byte-identical to their preceding artifacts.

## Exact-board gates

### Settled Week 4

The replay reconstructed 1,115 exact offers and 249 feature rows without a
provider call, then matched all 720 incumbent decisions. Against the production
incumbent:

- independent point-projection changes: 0;
- posterior projection changes: 390;
- probability changes: 388;
- actionables: 9 to 9;
- promotions/demotions: 1/1, both settled wins;
- actionable units: +0.11989 to +0.19564;
- resolved Brier: 0.26012 to 0.25609;
- resolved log loss: 0.72674 to 0.71527;
- calibration gap: 0.10268 to 0.10197;
- nonpositive-EV actionables: 0;
- writes/provider calls: 0/0.

The single promotion was Trevor Lawrence Passing Attempts Under 33.5. The
single demotion was Cam Ward Passing Attempts Under 32.5. This is the required
symmetric promotion/demotion path, not a quota-driven suppression.

### Unlocked Week 5 board

The SELECT-only audit matched all 967 stored rows from the 2026-10-07 14:51:10Z
snapshot and changed no independent point. It reconstructs the archived
passing-workload point interval from the preceding distribution and proves an
exact actionable range even where the archived compact payload cannot identify
one residual step:

- actionables: 12 to exactly 11 (91.7% retained, above the frozen 80% gate);
- promotions/demotions: 3/4;
- candidate actionable mix: 2 Overs and 9 Unders;
- nonpositive-EV actionables: 0;
- provider calls/writes: 0/0;
- locked rows in this current snapshot: 0.

The promotions were Bhayshul Tuten Receiving Yards Under 9.5, Tyson Bagent
Passing Attempts Over 31.5, and Jared Goff Rushing Yards Over 0.5. The
demotions were Geno Smith Passing Yards Under 206.5, Tyson Bagent Passing
Attempts Under 31.5, Sam Darnold Rushing Yards Under 4.5, and Josh Allen Passing
Attempts Under 32.5. The two archived Matthew Stafford Passing Yards rows can
straddle 50% within the recoverable residual interval, but remain No Play under
every value and therefore do not affect the exact board count.

## Release and safety contract

- portable: `nfl_player_props_runtime_2026_10_07_r7_market_selective_mean_quintile`
- model: `nfl_player_props_distribution_model_2026_10_07_r16_market_selective_mean_quintile`
- calibration: `nfl_player_props_distribution_calibration_2026_10_07_r18_market_selective_mean_quintile`
- decision: `nfl_player_props_decision_2026_10_07_r21_market_selective_mean_quintile`
- runtime: `nfl_player_props_runtime_2026_10_07_r22_market_selective_mean_quintile`
- board: `nfl_player_props_board_2026_10_07_r25_market_selective_mean_quintile`
- member/lifecycle: `nfl_player_props_member_2026_10_07_r33_market_selective_mean_quintile` / `nfl_player_props_member_lifecycle_2026_10_07_r16_market_selective_mean_quintile`
- writer/tracking: `nfl_player_props_writer_2026_10_07_r38_market_selective_mean_quintile` / `nfl_player_props_tracking_2026_10_07_r21_market_selective_mean_quintile`

The release is calibration-only. It adds no provider request, new data source,
writer, schedule, lease, UI field, copy, alternate-line ladder, stake, or live
reader migration. Publication remains blocked until the coordinated NFL injury
continuity PR merges, this branch is rebased on the resulting latest `main`, all
focused checks and `verify:model-change` pass again, integration safety proves
the latest base is an ancestor, and the protected PR is green and current.
