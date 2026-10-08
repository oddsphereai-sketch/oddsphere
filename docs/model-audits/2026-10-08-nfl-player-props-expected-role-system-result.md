# NFL player props expected-role system result

Date: 2026-10-08  
Production base: `e998e5211b634f0fd3f3dae776300f97137e6010`  
Status: research-only; no live release authorized

## Decision

The roster-constrained expected-role architecture is a real independent-model improvement, not a
market blend. It improves 2025 MAE and RMSE over the prior independent reference in all seven
ordinary prop families and improves the old independent model on the exact 2026 locked replay in
all seven families. Passing Attempts also beats the published point forecast on both MAE and RMSE.

Do not publish the complete candidate. It does not beat the published forecast over the complete
207-scope 2026 replay, and its game-clustered candidate-minus-published MAE interval is not below
zero. Existing production behavior and every locked record remain unchanged.

## Frozen architecture

The system uses no target prop line, price, market probability, spread, or total. It forecasts:

- team passing opportunity and the expected lead passer's share;
- position-role rushing and receiving budgets;
- roster-normalized player participation and workload shares;
- bounded completion rate, yards per attempt, catch rate, yards per target, and yards per carry;
- point-in-time depth and injury/availability state; and
- current, shifted team/opponent play mix, pressure, air-yard, YAC, weather, PFR, FTN, and public
  Next Gen Stats features.

The candidate was selected on 2024, confirmed once on 2025, and only then scored on the already
opened 2026 Weeks 1-4 window. Frozen weights were 100% expected-role for Passing Attempts; 75% for
Passing Completions, Passing Yards, Rushing Attempts, and Rushing Yards; and 50% for Receptions and
Receiving Yards.

## Correctness defect found during replay

The first diagnostic projection incorrectly used every player who eventually participated as the
set known active before kickoff. That leaked postgame participation and diluted offered-player
shares across unoffered bench players.

The corrected replay consumes only the existence of a pregame player/market offer as active-role
evidence. It never consumes the offer's line, price, side, or outcome. One causal projection is
created per player/game/market and joined back to every immutable locked offer, preserving all
alternate lines and books. Player suffix normalization uses the same identity rule as the existing
locked replay. Coverage is 207/207 scopes across 47 games.

## 2025 chronological confirmation

| Market | Prior MAE / RMSE | Expected-role MAE / RMSE |
| --- | ---: | ---: |
| Passing Attempts | 8.2140 / 10.7396 | **6.8564 / 8.6838** |
| Passing Completions | 5.5660 / 7.2409 | **4.6562 / 5.9975** |
| Passing Yards | 67.2200 / 87.0595 | **57.3374 / 73.6645** |
| Rushing Attempts | 3.0545 / 4.1502 | **2.9791 / 4.0972** |
| Rushing Yards | 18.5580 / 27.4685 | **18.0650 / 26.9192** |
| Receptions | 1.4599 / 1.9282 | **1.4464 / 1.9085** |
| Receiving Yards | 19.5186 / 27.0056 | **19.3213 / 26.6347** |

## Exact 2026 locked replay

Overall point results:

| Forecast | MAE | RMSE | Bias | Direction |
| --- | ---: | ---: | ---: | ---: |
| Expected-role candidate | **20.5620** | **39.9126** | -7.8452 | 50.72% |
| Locked independent | 21.8400 | 41.8176 | -10.5613 | 50.72% |
| Published | 19.2661 | 37.2641 | -5.3554 | 51.69% |
| Offered line, descriptive only | 19.4082 | 36.8801 | -4.6594 | — |

By market:

| Market | Candidate MAE / RMSE | Old independent | Published | Finding |
| --- | ---: | ---: | ---: | --- |
| Passing Attempts | **8.9446 / 11.2646** | 9.2854 / 13.3294 | 9.3443 / 12.2757 | candidate wins point error |
| Passing Completions | 7.3870 / **8.1261** | 12.3257 / 14.9176 | **7.0371** / 8.2106 | candidate wins published RMSE only |
| Passing Yards | 71.3430 / 93.2708 | 83.1602 / 100.6275 | **61.3931 / 89.2179** | improves independent only |
| Rushing Attempts | 2.9464 / **3.2830** | 3.7416 / 4.3974 | **2.8197** / 3.3302 | wins published RMSE and direction |
| Rushing Yards | 16.8592 / 23.4440 | 17.5655 / 24.9481 | **16.3037 / 22.4425** | improves independent only |
| Receptions | 2.0519 / 2.8743 | 2.0989 / 2.9502 | **1.8363 / 2.6080** | improves independent only |
| Receiving Yards | 33.8990 / 51.3062 | 34.3320 / 52.4219 | **32.4609 / 46.9262** | improves independent only |

The candidate improves the old independent MAE in Weeks 1-3 and regresses it in Week 4. The
game-clustered candidate-minus-independent MAE interval is `[-3.310, 0.329]`; the
candidate-minus-published interval is `[-0.039, 2.894]`. Neither supports a promotion claim.

Probability calibration also improves substantially over the stored independent probabilities but
does not beat the market:

- candidate Brier `0.26559`, calibration gap `0.10838`;
- exact locked-independent Brier `0.31339`, calibration gap `0.25084`;
- market Brier `0.24946`, calibration gap `0.01237`; and
- published Brier `0.25082`, calibration gap `0.04393`.

## What the remaining gap means

The replay's offered Receiving Yards players averaged 56.17 actual yards against a 40.80 offered
line and 38.77 published projection. The independent candidate remains too low, but the market and
published model were also approximately 15-17 yards low. Fitting a four-week additive correction
to that realized spike would be target leakage disguised as accuracy. A fixed rolling-origin bias
diagnostic reduced overall candidate RMSE but did not improve MAE materially and worsened several
families, so it is rejected.

The next architectural improvement is not another market weight. Receiving Yards must be decomposed
into routes, targets, completion probability, completed air yards, and YAC, with quarterback quality
and roster availability shared across the same simulated game. Rushing Yards likewise needs team
designed-rush opportunity, constrained carry shares, and a separate line/front efficiency process.
Assignment-level CB/WR and OL/DL features may enter only when the same timestamped source exists for
historical training and live pregame inference.

## External-research alignment

The architecture follows the available evidence rather than treating raw box-score splits as
causal matchups:

- nflfastR's public completion-probability and expected-YAC work supports separating receiving
  opportunity from catch and YAC efficiency;
- public expected-fantasy-points work emphasizes target volume, quarterback quality, game script,
  and teammate health rather than one-game production;
- Huddle's technical description prices player props from common game/player inputs through a
  simulation layer rather than isolated per-prop regressions; and
- opponent-adjusted pass-block/pass-rush research finds only modest gains after controlling for
  interaction context, supporting regularized unit effects rather than invented deterministic
  OL/DL or CB/WR matchup multipliers.

References:

- https://opensourcefootball.com/posts/2020-08-30-calculating-expected-fantasy-points-for-receivers/
- https://opensourcefootball.com/posts/2020-09-28-nflfastr-ep-wp-and-cp-models/
- https://huddle.tech/wp-content/uploads/2024/02/Technical-Overview-of-Huddles-Player-Props-1.pdf
- https://arxiv.org/abs/2604.01491

## Market reader boundary

The retained Week 5 product evidence already contains same-book opening/current lines and prices,
but only seven source-qualified sharp observations, all Circa and none Pinnacle or Bookmaker. That
is enough to display transparent movement, not enough to fit or authorize a sharp-movement flip.

Keep three separate objects: immutable independent forecast, timestamped market observation, and
published decision. Accumulate opening, T-24, T-6, and T-60 movement by exact player/market/book.
Test confirmations, warnings/demotions, and flips separately. Missing sharp evidence remains neutral,
and movement never rewrites the independent point forecast.

## Release boundary

No production model identifier is bumped because no production behavior changes. The research
release is `nfl_player_props_expected_role_system_2026_10_08_r1`; the corrected exact replay is
`nfl_player_props_expected_role_system_2026_locked_replay_2026_10_08_r2`. Existing locked payloads
are neither recomputed nor reinterpreted.
