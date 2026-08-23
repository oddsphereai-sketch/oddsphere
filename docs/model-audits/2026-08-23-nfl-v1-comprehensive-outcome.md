# NFL v1 comprehensive outcome forecast

Date: 2026-08-23

Status: candidate member outcome/score release; exact-price Bet grades, stakes, tracking, spread probability, and total probability remain Held.

## Decision

Publish the passing football-only score and winner forecast as its own outcome axis. Do not treat the failed market blend, failed independent exact-price policy, or rejected spread/total heads as a reason to hide the valid forecast behind 0-0 placeholders. Conversely, do not convert an outcome forecast into a wager.

Releases:

- artifact: `nfl_v1_week_one_outcome_artifact_2026_08_23_r1`
- point model: `nfl_v1_comprehensive_outcome_2026_08_23_r1`
- joint distribution: `nfl_v1_bivariate_score_distribution_2026_08_23_r1`
- win probability: `nfl_v1_beta_calibrated_win_ensemble_2026_08_23_r1`
- source tournament: `nfl_v1_comprehensive_shadow_2026_08_23_r6`

The single leased NFL forward-evidence writer remains authoritative. This reader artifact adds no writer, provider call, database write, decision tuple, grade, stake, or tracking row.

## Frozen evidence

The full protocol was frozen before the r1-r6 runs in `2026-08-22-nfl-v1-comprehensive-predeclaration.md`. Football features exclude sportsbook lines, odds, fair probabilities, splits, movement, target-game results, eventual starters, finalized same-week injuries, and realized weather.

The independent package passed all predeclared football-only confirmation gates in both 2024 and 2025:

- 2024 win probability: .21209 Brier / .61431 log loss / 7.61% ECE versus the football baseline .21266 / .61541; score, margin, and total composite MAE improved on the selected football baseline; 80% margin/total coverage was 79.7% / 81.9%.
- 2025 win probability: .22119 Brier / .63212 log loss / 3.03% ECE versus the football baseline .22362 / .63616; score, margin, and total composite MAE improved on the selected football baseline; 80% margin/total coverage was 81.3% / 78.7%.
- The opening market remained better and is not claimed otherwise: 2024 Brier .20231 and 2025 .21288. The release is explicitly an independent OddSphere forecast, not a market-superior forecast.

Current Week 1 structure is healthy rather than clustered:

- team scores: 17.57–27.75, standard deviation 2.443
- margins: -4.10 to +10.18, standard deviation 3.751
- totals: 38.66–48.98, standard deviation 2.766
- total direction from the independent score distribution: six Over and ten Under probabilities above 50%
- three winner disagreements with the opening market

## Rejected layers preserved

The r6 chronological rolling market-memory experiment was the sixth materially distinct spread/total attempt. It added only pre-week fast/slow ATS and total residual memory and retained the 2021-22 training, 2023 selection/calibration, and 2024-25 confirmation boundary.

- Spread selected a residual Extra Trees head and cleared every 2024/25 confirmation metric, but it remains informational because no exact-price spread policy has been authorized.
- Total selected no eligible family and fell back to 50%; total probability and Bet grade remain Held.
- The market-correction blend again failed its frozen gate and cannot replace the independent outcome head.
- The independent exact-price moneyline policy again failed, including -6.304 units / -21.74% ROI in 2025.
- The separate existing market-led r6 moneyline lane remains shadow-only. Its historical 2024/25 record is 252 actions, +18.944 units, +7.52% ROI, but current quarterback designations are projected and 2026 T-60/CLV/settlement evidence does not yet exist. No member promotion is applied here.

## Board impact and semantics

Outcome/score publication adds 16 informational forecasts. Applied Bet-grade promotions and demotions are both zero; all 48 exact-price markets remain Held. The reader shows:

- an independent winner probability for each game;
- nonzero away/home score, margin, and total projections;
- verified current and Opening markets, Playbook public splits, depth, injuries, and weather as separate context;
- `Bet grade · Held` without inventing a price-sensitive recommendation.

Rollback is the prior held reader `nfl_week_one_held_member_fixture_2026_08_22_r1`, which suppresses forecasts behind 0-0 placeholders. The evidence collector, stored rows, r6 shadow decisions, and locks do not change under rollback.
