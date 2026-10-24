# NFL player props Passing Touchdowns strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_passing_td_chronological_2026_10_16_r2`

Production changes: none

## Calendar-ordered result

Training used 2017-2023. Selection on 578 eligible 2024 quarterback-games again chose the Poisson HGB. After refitting through 2024, the model scored 578 eligible 2025 quarterback-games across 271 games.

| 2025 metric | Independent opportunity foundation | Poisson HGB | Change |
|---|---:|---:|---:|
| Mean projection (actual 1.3651) | 1.4433 | 1.3640 | candidate bias -0.0011 |
| MAE | 0.9643 | **0.9237** | **-0.0406** |
| RMSE | 1.1560 | **1.1208** | **-0.0352** |
| Mean Poisson deviance | 1.1766 | **1.1095** | **-0.0671** |
| Average threshold Brier | 0.15496 | **0.14941** | **-0.00556** |
| Threshold Brier wins | — | **4 of 4** | pass |

The 271-game paired bootstrap excluded zero in the improving direction for the two frozen interval gates and for MAE:

- MAE delta: -0.0409, 95% interval -0.0640 to -0.0172;
- Poisson deviance delta: -0.0675, 95% interval -0.1069 to -0.0289; and
- average Brier delta: -0.00560, 95% interval -0.00918 to -0.00207.

The candidate improved Poisson deviance and average Brier in all three pass-opportunity terciles. It improved deviance in all three red-zone-opportunity terciles and Brier in two of three; the low red-zone Brier change was a 0.13% relative regression, inside the frozen 3% tolerance. All segment gates passed. The dispersion check remained compatible with the Poisson family: observed variance 1.366, mean predicted variance 1.364, and residual-variance/predicted-mean ratio 0.923.

Feature availability was strong: 58 retained pregame features with 97.55% mean row coverage in 2024 and 97.60% in 2025; fifth-percentile coverage was 82.76% in both seasons.

The expanding-window 2026 Weeks 2-5 check remained directionally positive—MAE 0.9051 to 0.8822, deviance 1.0709 to 1.0468, Brier 0.15235 to 0.14851—but its 63-game bootstrap intervals crossed zero, as already documented.

## Decision and blocker

Retain the Poisson HGB as the independent Passing TD research foundation. It passes every frozen retrospective overall and segment gate without market anchoring.

Do not authorize production. The previous r1 work already used 2025 for selection, so this correctly ordered replay is not an epistemically untouched holdout. The next required evidence is prospective post-declaration quarterback outcomes joined to release-pure exact Passing TD books, lines, prices, and timestamps. Until then there is no authorized offered-line calibration, economic decision rule, board expansion, grade, or member row.
