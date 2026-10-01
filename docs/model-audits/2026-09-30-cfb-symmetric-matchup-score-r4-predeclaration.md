# CFB symmetric matchup score redesign r4 — predeclaration

Date: 2026-09-30

Status: research-only; frozen before the r4 tournament is scored

## Problem being tested

The r3 opponent-adjusted/direct-head candidate improved several score-error
metrics but reduced 2026 matched-line Spread direction from 49.3% to 44.9%.
That candidate is rejected and cannot alter production.  A smaller hybrid that
preserved the incumbent independent margin was useful diagnostically, but it is
not a replacement for a strong independent Spread model.

R4 tests whether a lower-dimensional, football-symmetric matchup architecture
can improve the independent forecast itself.  The model remains price, line,
split, movement, and market-side blind.  Market reading is evaluated only after
the independent score distribution is frozen.

## Frozen architecture

1. Transform every game into two team/opponent rows and fit one shared points
   model.  Swapping home and away teams must swap the predicted team scores;
   separate home/away regressions cannot learn incompatible equations.
2. Use compact, pregame-only matchup features covering opponent-adjusted
   scoring, pass/QB efficiency, rush and line play, success/explosiveness,
   early-down and red-zone execution, third downs, expected turnovers,
   possessions/drives, field position, special teams, penalties, Elo, roster
   continuity, returning-QB evidence, rest, and home/neutral context.
3. Fit separate direct margin and Total heads from the corresponding difference
   and sum features.  Evaluate the shared score head and fixed blends of the
   shared and direct heads; the final home and away means are always derived
   algebraically from one margin and one Total.
4. Use the existing paired past-only football-score residual simulator so every
   winner, Spread, Total, expected score, and representative score comes from
   one coherent joint distribution with natural decimal means.

## Chronology and selection

The 2021-2025 archive and 2026 settled games have already been opened in prior
research.  R4 therefore makes no pristine-holdout claim.  It uses rolling-origin
season tests—train only on seasons before the test season—and reports 2023,
2024, and 2025 separately.  Model family and fixed blend choice are selected by
robust multi-season rank, not by one season or the current 2026 outcomes.  The
2026 replay is a retrospective stress test only.

The candidate must be compared with the exact incumbent independent engine on
the same games and lines.  Promotion requires:

- lower team-score, margin, and Total MAE in the pooled 2023-2025 test and no
  material score-error regression in any individual season;
- non-inferior Moneyline accuracy/Brier, Spread direction, and Total direction
  in the pooled test, with improvements not isolated to one season;
- realistic score, margin, and Total dispersion rather than clustered output;
- no score/side, event-containment, line, or price contradiction;
- an unchanged provider budget, writer cadence, lease, member copy, labels,
  layout, and lock/tracking contract.

The 2026 replay may reject a candidate but cannot by itself qualify one.  A
failure on Spread is a model failure, not permission to hide games, demote the
board, invert a probability band, or anchor the score to consensus.

## Market-reading boundary

After an independent candidate passes, immutable pre-kickoff evidence is used
to test source- and market-specific arbitration.  Circa and Pinnacle same-book
movement, line movement, price movement, reverse-line movement, sharp splits,
and fallback/public splits retain distinct provenance and reliability.  There
is no fixed market percentage.  A validated read may confirm, adjust, or flip
the relevant margin/Total/winner state, after which one coherent joint score
distribution is rebuilt.  Unsupported or contradictory evidence leaves the
independent forecast unchanged.

No r4 output is production-authorized by this predeclaration.
