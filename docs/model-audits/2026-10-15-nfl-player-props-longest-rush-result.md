# NFL player props: longest rush result

Date: 2026-10-15

Verdict: adopt the log-scale Poisson-independent boosted model as the Longest Rush research foundation; do not add the market to production until exact offers/prices are retained.

## Result

The log-scale boosted model won predeclared 2025 selection and improved every 2026 gate.

| 2026 Weeks 2-5, 436 eligible player-games | Recent-long/opportunity foundation | Selected model |
|---|---:|---:|
| MAE | 7.2971 yards | **5.3167 yards** |
| RMSE | 10.1974 yards | **9.2698 yards** |
| Average threshold Brier | 0.14831 | **0.11442** |

The model improved all five tested thresholds (over 9.5, 14.5, 19.5, 24.5, and 29.5 yards). Its average projection was 8.50 yards versus an observed mean of 10.48, reflecting conservative tail shrinkage; the threshold probabilities were nevertheless much better calibrated than the foundation's systematically high probabilities.

## Uncertainty

A 2,000-draw paired bootstrap over 63 games strongly favored the selected model:

| Candidate-minus-foundation delta | Mean | 95% interval | Probability candidate improves |
|---|---:|---:|---:|
| MAE | -1.980 yards | [-2.405, -1.557] | 100% |
| RMSE | -0.934 yards | [-1.472, -0.381] | 100% |
| Average threshold Brier | -0.03384 | [-0.04145, -0.02594] | 100% |

This is the clearest non-market accuracy improvement among the newly tested non-production families.

## OddSphere archived-game slice

Fourteen eligible rushers appeared in the two games from OddSphere's Week 5 private archive.

| Metric | Foundation | Selected |
|---|---:|---:|
| MAE | 9.692 yards | **6.155 yards** |
| RMSE | 16.813 yards | **15.905 yards** |
| Average threshold Brier | 0.13875 | **0.09153** |

The model correctly shrank several plausible pregame rushers who ultimately recorded no qualifying rush, including Ty Johnson, Matthew Stafford, Dak Prescott, and Tyler Goodson. The large remaining error came from Bucky Irving's 72-yard rush; the model projected 14.36. That is an extreme-tail miss, not a reason to inflate every player's central projection.

## Why the model improved

Longest Rush is not average rushing yards. It combines a participation/opportunity hurdle with the maximum of a variable number of rushes. The selected model uses prior carry opportunity, rush share, longest/explosive history, team/opponent rush volume, position-specific opponent allowance, NGS efficiency/RYOE/box context, PFR before/after-contact data, FTN box/motion/RPO context, depth/role, and weather. Training on `log(1 + longest rush)` reduces the influence of isolated 50-80 yard outcomes while retaining nonlinear matchup and role interactions.

NFL Next Gen Stats explicitly uses tracking data to derive expected rushing yards and captures player movement, speed, and formation context, supporting the inclusion of retained NGS efficiency and box variables rather than treating every carry as identically distributed. [NFL Football Operations: Next Gen Stats](https://operations.nfl.com/gameday/technology/nfl-next-gen-stats)

An NFL Big Data Bowl study likewise models rush success from mixed player/game context and tracking-derived variables, supporting the combination of player skill and team/defense context. [NFL Big Data Bowl rushing study](https://operations.nfl.com/media/4207/bdb_pash_powell.pdf)

## Product decision

This becomes the Longest Rush research foundation, but it is not live because no release-pure Longest Rush lines/prices were retained and the exact sportsbook offer universe is unknown. Before production, OddSphere needs:

1. prospective exact-offer capture and official settlement semantics for zero-attempt participants;
2. line-specific calibration and economic replay;
3. explicit tail diagnostics by RB/QB/WR and carry-opportunity tier;
4. a versioned model/calibration/decision/lock/reader path.

No production model, calibration, grade, stake, writer, reader, or public page changed.
