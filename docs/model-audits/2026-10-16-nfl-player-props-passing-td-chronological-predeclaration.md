# NFL player props Passing Touchdowns strict chronology predeclaration

Date: 2026-10-16

Release: `nfl_player_props_passing_td_chronological_2026_10_16_r2`

Production changes authorized: none

## Honest boundary

The prior r1 tournament selected on 2025, so 2025 cannot be called an untouched holdout. This r2 audit freezes a correct calendar order—train 2017-2023, select on 2024, confirm retrospectively on 2025, and report 2026 Weeks 2-5 separately—but `confirmationEpistemicallyUntouched` must remain false. Only future post-declaration games can provide a genuinely untouched confirmation.

## Frozen candidate set

Retain the exact r1 candidates and market-free feature contract:

1. the independent opportunity foundation (`attempts × blended QB/team/opponent TD rate`);
2. a Poisson GLM; and
3. a Poisson-loss histogram gradient-boosted tree.

No market line, price, consensus, or movement may enter the count model. The fixed threshold set remains 0.5, 1.5, 2.5, and 3.5 passing touchdowns.

## Frozen replay

- Fit candidates on 2017-2023.
- Select on 2024 by mean Poisson deviance, then average threshold Brier, then MAE.
- Refit the selected architecture through 2024 and score 2025 once.
- Refit through 2025 and report 2026 Weeks 2-5 only as already-inspected external confirmation.

Freeze two pregame 2025 segment families from 2024 cut points:

- projected pass-volume terciles from lagged quarterback/team/opponent attempts; and
- projected red-zone pass-opportunity terciles from lagged team/opponent red-zone pass attempts.

## Frozen retrospective gates

Overall 2025 must improve mean Poisson deviance, MAE, and average threshold Brier; win at least three of four threshold Brier scores; keep absolute mean bias below 0.20 TD; and have game-clustered 95% intervals for Poisson deviance and Brier deltas exclude zero in the improving direction.

For each segment family, no tercile may worsen mean Poisson deviance or average Brier by more than 3%, and at least two of three terciles must improve both metrics.

Even if every retrospective gate passes, production remains prohibited without future genuinely prospective confirmation and the release-pure exact-offer/price ledger required for offered-line calibration, economics, promotions/demotions, and board impact.
