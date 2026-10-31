# NFL player props Interceptions strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_interceptions_chronological_2026_10_16_r2`

Production changes: none

Training used 3,821 eligible quarterback-games from 2017-2023. Selection on 578 eligible 2024 quarterback-games chose Poisson HGB. After refitting through 2024, the model scored 578 eligible 2025 quarterback-games across 271 games.

| 2025 metric | Pooled independent foundation | Poisson HGB | Change |
|---|---:|---:|---:|
| Mean projection (actual 0.619) | 0.706 | 0.664 | candidate bias +0.045 |
| MAE | 0.67524 | **0.65829** | **-0.01695** |
| Mean Poisson deviance | 1.10420 | **1.05345** | **-0.05076** |
| Average threshold Brier | 0.09995 | **0.09680** | **-0.00315** |
| Threshold Brier wins | — | **4 of 4** | pass |

The 271-game paired bootstrap excluded zero for Poisson deviance (-0.05067; 95% interval -0.09047 to -0.01289) and average Brier (-0.00315; -0.00603 to -0.00031). The MAE interval narrowly crossed zero (-0.01705; -0.03517 to +0.00076), but MAE interval exclusion was not a frozen gate. All low/medium/high pass-opportunity and pressure-exposure tiers improved both deviance and Brier without approaching the allowed 3% regression boundary. The candidate therefore passes every frozen retrospective r2 gate.

That is not the whole evidence record. The already-inspected 2026 Weeks 2-5 sample reverses direction: MAE 0.65089 to 0.65332, deviance 1.04279 to 1.05940, and average Brier 0.09549 to 0.09677. All three 63-game intervals cross zero and their means favor the pooled foundation.

Classify Poisson HGB as **retrospectively validated but externally unresolved**. Do not replace the pooled foundation, tune to either opened season, or authorize production. The earlier r1 work had already opened both 2025 and 2026, so neither is an epistemically untouched confirmation. A newly declared prospective window must decide whether the 2025 gain is stable or the 2026 reversal is representative; a release-pure exact Interceptions offer/price ledger is also required.
