# NFL player props: longest pass result

Date: 2026-10-15

Release: `nfl_player_props_longest_pass_tournament_2026_10_15_r1`

Decision: retain the HGB log model as the independent research foundation. It passes the frozen current-season accuracy gate, but it is not authorized for production because the archive contains no release-pure Longest Pass offers and exact prices.

## Frozen replay

The candidate was selected on 602 quarterback-games from 2025, refit through 2025, and evaluated once on 136 quarterback-games from 2026 Weeks 2-5. Sportsbook lines, prices, consensus, and movement were excluded from every feature.

| 2026 Weeks 2-5 | Foundation | HGB log |
|---|---:|---:|
| MAE | 13.2974 | **10.5757** |
| RMSE | 17.0973 | **14.3429** |
| Average threshold Brier | 0.22465 | **0.19760** |
| Threshold Brier wins | — | **5 of 5** |

The 63-game paired bootstrap estimated candidate-minus-foundation deltas of -2.738 yards MAE (95% CI -4.318 to -1.150), -2.784 yards RMSE (-4.392 to -1.249), and -0.02718 average Brier (-0.04411 to -0.00983). The probability of improvement was 100%, 100%, and 99.9%, respectively.

## Small archived slice

The four quarterbacks in OddSphere's two archived Week 5 games were an unusually explosive group: their mean actual longest pass was 50.75 yards. The HGB candidate did not improve that four-row slice (MAE 19.74 versus 19.68; Brier 0.3869 versus 0.3203). This slice is reported rather than hidden, but it does not override the predeclared 136-quarterback current-season evaluation.

The largest visible limitation is upper-tail compression. Josh Allen, Dak Prescott, and Jalon Daniels produced 57-, 48-, and 64-yard completions while the model projected 36.9, 36.1, and 19.7 yards. A future distribution should model explosive-completion frequency and severity separately instead of relying on a single homoscedastic log residual.

## Product decision

The accuracy gate passes. Production remains unchanged because there is no release-pure Longest Pass price ledger with which to test side, calibration, exact-price economics, grade impact, or board size. The candidate is a concrete independent foundation for the next retained slate; market reading remains a separate confirmation layer rather than an input to this projection.

Reproduction:

```bash
football-research/cache/nfl-model-env/bin/python \
  scripts/operator/tournament_nfl_player_props_longest_pass.py \
  --features=football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.parquet \
  --historical-root=football-research/cache/nflverse/real-model-r1 \
  --current-root=football-research/cache/nfl-player-props-external/current \
  --output=football-research/cache/nfl-player-props-external/tournament/nfl_player_props_longest_pass_r1.json
```

