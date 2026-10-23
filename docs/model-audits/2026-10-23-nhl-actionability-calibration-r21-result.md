# NHL actionability calibration audit — 2026-10-23

## Decision

Do not change the live NHL model or grade policy from this audit. The concern is
valid: recent NHL actionability is not well calibrated. But neither tested
decision-only repair passed the predeclared market-specific and non-flat-board
gates. Shipping either would hide a weak current Moneyline head behind broad
demotions and would nearly remove Totals without proving that the retained
Totals are better.

No prediction, probability, score, pick, line, price, grade, stake, release,
reader, writer, cron, or locked record was changed.

## Evidence scope

The SELECT-only audit used 144 complete, priced, officially settled NHL games
and 432 immutable market locks from the r14-r20 decision-policy family. Games
were ordered by `locked_at`; the first 100 games were the selection segment and
the final 44 were the chronological confirmation segment. Exact release results
are reported separately. The combined cohort is a decision-policy diagnostic,
not a claim about the current r20 release.

The current r20 release has only 12 settled games, so its result is an alert,
not a stable estimate. The r18 and r20 releases share the opening-window fast-
state probability path and provide 47 forward games together.

## Incumbent diagnosis

Across the combined r14-r20 diagnostic, 282/432 markets (65.3%) were actionable.
They went 162-120 (57.45%) for -5.23 units. Watchlists went 83-67 (55.33%) for
-8.11 units. That separation is too small for the difference implied by the
labels.

The chronology is worse. In the final 44 games, 81/132 markets (61.4%) were
actionable and went 43-38 (53.09%) for -9.85 units, while Watchlists went 31-20
(60.78%) for +1.72 units. The ranking inverted: the supposedly stronger tier
performed worse than the watch tier.

The release split localizes the deterioration:

| release | actionables | record | accuracy | exact-price units |
| --- | ---: | ---: | ---: | ---: |
| r17 target-excluded Total | 98/159 | 60-38 | 61.22% | +4.16u |
| r18 fast-state direct | 64/105 | 34-30 | 53.13% | -8.29u |
| r20 verified current board | 22/36 | 11-11 | 50.00% | -3.21u |

The r18+r20 actionable decline is concentrated in Moneylines: 13-19 (40.63%)
and -11.69 units. Their puck-line actionables are 19-9 (67.86%, +1.81u), and
Totals are 13-13 (50.00%, -1.62u). A global actionability cut would therefore
attack the wrong problem and could damage the still-useful puck-line lane.

The r20-only 12-game Moneyline result is 3-6 among actionables. Its small sample
does not authorize a replacement model, but it agrees with the larger r18
forward warning rather than contradicting it.

## Rejected probability/edge grid

The predeclared 625-candidate grid selected a zero-edge floor with probability
floors of 56% Moneyline, 52% Total, and 54% puck line using only the first 100
games.

- Selection improved from 119-82 (59.20%, +4.61u) to 107-62 (63.31%, +16.56u).
- Confirmation improved overall from 43-38 (53.09%, -9.85u) to 31-23 (57.41%,
  -4.93u), retaining 54/132 actionables.
- It failed the market gate: confirmation Totals collapsed to 1-6 (14.29%,
  -5.07u), and active r20 actionables worsened from 11-11 to 6-8.

The candidate is rejected. The overall gain cannot conceal the Total failure or
the regression on the actual current release.

## Rejected historical-structure rule

A second fixed rule used only boundaries published from 2024 selection and
untouched 2025 confirmation: 58%/non-negative edge for Moneyline, a 0.30-goal
projection gap/non-negative edge for Total, and 58%/1.5pp edge for puck line.

- Selection improved from 119-82 (59.20%, +4.61u) to 84-49 (63.16%, +7.77u).
- Confirmation improved overall from 43-38 (53.09%, -9.85u) to 24-17 (58.54%,
  -3.37u).
- It produced zero actionable promotions, demoted 108 actionables over the full
  cohort, and retained only one confirmation Total, which lost.

That violates the paired-promotion and market-retention gates. It is a broad
demotion mask, not a professional calibrated board, and is rejected.

## Current board impact

The exact unlocked 2026-10-23 board contains two games, six markets, two Leans,
and four Watchlists. Both actionables are one Moneyline and one puck line; no
Total is actionable. The current slate is therefore not overpopulated, and an
emergency live threshold change would add risk without solving the measured
release-specific problem.

## Root cause and next valid path

The dominant issue is not a single permissive universal threshold. The same
grade policy produced 61.22% and +4.16u under r17, then 53.13%/-8.29u under r18
and 50.00%/-3.21u under r20. The opening-window fast-state Moneyline probability
head is overconfident in its forward r18/r20 locks, so its grade inputs no
longer rank plays reliably. Puck lines do not show the same failure.

The next model change should therefore be a release-aware Moneyline calibration
study, not a global demotion:

1. fit a bounded calibration transform using only r18 forward locks;
2. test it on a genuinely later locked cohort after r20, or on an independently
   reconstructed 2025 opening-window exact-price cohort;
3. keep score/side and the market reader separate while measuring Brier, log
   loss, Moneyline actionability, units, promotions, demotions, and current-board
   impact;
4. let the existing ten-game opening-window boundary return games to the r17
   statistical path unless an independently validated replacement qualifies.

Until that evidence exists, preserving r20 is safer than deploying a rule that
looks better only because it labels most weak markets Watchlist.

