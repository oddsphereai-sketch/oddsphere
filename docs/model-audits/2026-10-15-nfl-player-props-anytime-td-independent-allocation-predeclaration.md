# NFL player props Anytime TD independent-allocation predeclaration

Date: 2026-10-15
Status: frozen before execution; research only

## Why this test

Anytime TD has the largest release-pure Week 5 loss cohort. The matched ledger separates losses
from wins on workload/share and pregame matchup, while the active raw touchdown head includes a
pregame sportsbook-implied team-touchdown feature. This challenger tests whether a genuinely
independent football allocation can replace that dependence rather than merely adding another
market blend.

## Candidate

The candidate predicts an independent team offensive-touchdown budget from strictly shifted team,
opponent, scoring-environment, efficiency, pressure/front, and weather context. It then allocates
that budget across the complete pregame `QB`/`RB`/`FB`/`WR`/`TE` roster from shifted carries,
targets, snap/depth, availability/vacated role, red-zone proxies, actual-opponent positional
allowance, offensive-line/defensive-front, PFR/FTN, and Next Gen Stats context. The player hazard is
`team touchdown budget × normalized player touchdown share`, converted to an anytime probability
as `1 - exp(-hazard)` and calibrated on the immediately preceding season.

Two finite share identities are frozen:

- direct expected touchdown share, multiplied by pregame participation probability; and
- a scorer hurdle: probability of scoring multiplied by touchdown share conditional on scoring.

Neither identity may consume a prop line, player price, sportsbook, consensus, movement, main-game
spread/total, market-implied team total, or current-game outcome. Public charting is used only at
the granularity it actually supplies; this is not represented as assignment-level tracking.

## Chronology and gates

- For 2024 selection, train football components through 2023 and calibrate only on predictions for
  2023 made from training through 2022.
- For 2025 confirmation, train through 2024 and calibrate only on predictions for 2024 made from
  training through 2023.
- The control is the released touchdown architecture refit under the same chronology, including its
  disclosed sportsbook-implied team-touchdown input.
- Selection requires lower Brier score and log loss with non-worse AUC. Confirmation also requires
  a below-zero game-clustered Brier-delta interval and no adverse fixed chronological segment.
- Only a confirmed frozen identity may open the complete immutable Week 5 2026 canonical Anytime TD
  board. It must improve Brier and log loss without worsening AUC or calibration gap.

Passing opens production parity, exact-price return, and balanced promotion/demotion review; it is
not automatic release authority. Failure changes no live probability, grade, stake, or locked row.
