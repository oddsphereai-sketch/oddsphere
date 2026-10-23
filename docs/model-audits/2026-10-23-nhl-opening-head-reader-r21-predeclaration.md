# NHL opening-head and market-reader r21 predeclaration

Date: 2026-10-23

Status: predeclared, SELECT-only audit. This document was committed before the
candidate replay was run. It authorizes no production change.

## Problem statement

The prior release-pure actionability audit localized the current NHL weakness:
the r18/r20 opening-window Moneyline actionables settled 13-19 (-11.69 units),
while the puck-line lane remained strong and a broad grade-grid repair failed
chronological confirmation. The audit also found that the existing market
reader changed very few opening-window Moneyline sides. This pass determines
whether the loss is primarily caused by the r18 fast-state independent head,
by reader arbitration, or by downstream grading.

## Immutable cohort and chronology

- Read only locked, settled NHL prediction records from exact model releases
  r18, r19, and r20.
- Use one stored feature snapshot per game and the stored result. Do not call a
  provider, reconstruct a missing lock, or modify any row.
- r18 is the selection/diagnostic cohort. Later r19/r20 locks are the untouched
  chronological confirmation cohort. If r19 has no settled locks, r20 remains
  the confirmation cohort.
- Report release-pure results and never blend the candidate with the incumbent
  under the incumbent release name.

## Fixed independent-head variants

Every variant reuses the exact locked inputs and current frozen model code:

1. `fast`: unchanged snapshot; this must numerically reproduce the stored r18+
   score path within floating-point tolerance.
2. `roster`: remove only both teams' fast-state objects while retaining the
   stored opening-window game counts. This activates the already shipped roster
   prior score path when both priors pass their existing coverage gate.
3. `mature`: remove both fast-state objects and set both opening-window game
   counts to 10. This activates the already shipped statistical/opponent-state
   path that owns games after the opening window.

No coefficient is fitted in this audit. These are existing frozen heads, not a
new learned model.

## Reader isolation

For every head, evaluate two forecasts:

- `independent`: the head's independent margin and total before the qualified
  market reader.
- `final`: the coherent score after the existing Moneyline and target-excluded
  Total reader executes on the exact stored market inputs.

For each market, count reader changes, corrections, harms, and unchanged calls.
Break Moneyline results down by independent-versus-market agreement, existing
reader decision, market-strength band, movement direction, and split alignment.
Market-favorite performance is diagnostic only and is never a proposed rule.

## Metrics

Report by cohort and head:

- Moneyline accuracy, home-win Brier score, and log loss;
- puck-line and Total directional accuracy with pushes isolated;
- team-score, margin, and total MAE;
- mean absolute predicted margin versus actual margin, including the share of
  forecasts and outcomes beyond 1.5 and 2.5 goals (compression check);
- current exact-price actionability, using only locked same-game prices, with
  count, W-L-P, units, ROI, Brier score, and market breakdown;
- promotions and demotions versus the stored release.

## Advancement gates

An independent-head replacement may advance only if all are true:

1. Selection and confirmation Moneyline accuracy do not decline.
2. Confirmation Moneyline Brier score does not worsen by more than 0.005.
3. Confirmation margin MAE does not worsen by more than 0.10 goals and total
   MAE does not worsen by more than 0.10 goals.
4. Neither puck-line nor Total confirmation results lose more than one net win.
5. The candidate does not merely inflate margins: its large-margin frequency
   must move toward the actual frequency while margin MAE is preserved.
6. Any changed actionable board contains at least one tested promotion as well
   as every proposed demotion, and the full count impact is reported.

A reader change may advance only if it produces more corrections than harms in
both selection and confirmation, preserves the continuous-metric gates above,
and is supported by a replayable evidence condition rather than market side
alone. A grade-only rule must pass the same chronological confirmation gate
used in the preceding r21 actionability audit.

Failure of any gate means no live behavior change. The result must identify the
failing layer and the next bounded research step.
