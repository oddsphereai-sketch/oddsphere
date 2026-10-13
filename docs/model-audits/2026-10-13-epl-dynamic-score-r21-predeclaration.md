# EPL dynamic score r21 research predeclaration

Date: 2026-10-13

Status: read-only research candidate. No production authority.

## Question

The active r20 model materially improves matchup margin but intentionally keeps
the r19 Total intensity. The exhaustive loss ledger shows that the remaining
score weakness is concentrated in goal-intensity/distribution accuracy rather
than a missing grade rule or a universal market-direction rule. This tournament
tests whether a sequential dynamic attack/defence score process improves the
independent score distribution without anchoring forecasts to sportsbook odds.

## Frozen candidate family

- One home attack, away attack, home defence-weakness and away
  defence-weakness state is maintained per club in log-goal space.
- States update only after a completed prior match. Same-round outcomes never
  enter another same-round forecast.
- The update target is a frozen goals/xG mixture. The candidate grid selects
  the mixture, state learning rate, state half-life and between-season
  regression.
- Previously unseen/promoted clubs begin at the league-neutral prior. No future
  match, evaluated price, split, movement, target sportsbook, grade or result is
  a feature.
- One Dixon-Coles joint score distribution supplies Match Result, Total, BTTS,
  expected scores and all proper-score metrics. There is no side override.

## Chronology

- 2022-2023: warm the dynamic state;
- 2024: select exactly one candidate from the frozen grid;
- 2025: open once as untouched holdout after selection.

The market-reader layer is not optimized in this tournament. It remains a
separate, target-excluded downstream arbitration question so independent-model
quality and market-reading quality cannot conceal one another.

## Gates

A production candidate must improve holdout team-score MAE plus at least one of
Total MAE/Total Brier, while not materially worsening Match Result Brier/log
loss, margin MAE, BTTS Brier, or score dispersion. It must later pass the
release-pure forward-evidence replay, coherent score reconstruction,
promotion/demotion pairing, model-change verification, integration safety and
live acceptance. Failure remains research evidence and cannot change member
predictions or grades.
