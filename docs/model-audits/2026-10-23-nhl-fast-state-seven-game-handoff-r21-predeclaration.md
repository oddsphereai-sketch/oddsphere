# NHL fast-state seven-game handoff r21 predeclaration

Date: 2026-10-23

Status: predeclared, research and SELECT-only replay. No live authority.

## Observed diagnostic

The exact 2026 reconstruction showed a stable architecture interaction by the
maximum current-season game count of the two teams. The fast-state head led the
existing roster/statistical comparator through six games, while the comparator
led at seven through nine. At ten games the current runtime already disables
both opening-only heads and uses the mature statistical path.

This observation was made before the candidate below was evaluated. It is not
an untouched discovery sample. The prior-season opening cohort is therefore
required as a separate historical check, and every current release remains
reported separately.

## Fixed candidate

`seven_game_handoff` uses the current fast-state direct-probability head only
while both teams have fewer than seven current-season games. Beginning when
either team has seven games, it uses the already shipped roster-prior head until
the existing ten-game mature-model boundary. At ten games and beyond, behavior
is unchanged.

The chosen head owns the entire coherent independent score and distribution.
The existing qualified Moneyline reader and target-excluded Total reader remain
downstream. This is not a weighted blend, margin multiplier, market-following
rule, fixed team override, or grade-only mask.

## Validation

1. Rebuild 2025 team and roster examples from the official MoneyPuck game-level
   downloads with strictly lagged state, frozen production coefficients, and
   the exact current game-count boundary. Report fast, roster, current
   ten-game handoff, and seven-game handoff results.
2. Replay all complete 2026 transition locks from strictly pre-slate MoneyPuck
   state. Report selection (pre-r18), r18 confirmation, r20 confirmation, and
   full results for Moneyline, puck line, Total, score MAE, reader effects, and
   exact-price actionability.
3. Preserve every locked payload unchanged.

## Advancement gates

The candidate may advance only if all are true:

- 2025 opening-window Moneyline accuracy does not decline versus the current
  ten-game fast boundary; Brier score may not worsen by more than 0.005.
- 2026 pre-r18 selection Moneyline accuracy does not decline.
- r18 and r20 confirmation Moneyline accuracy each do not decline, and combined
  confirmation Brier score improves.
- Combined-confirmation margin MAE does not worsen by more than 0.10 goals and
  Total MAE does not worsen by more than 0.10 goals.
- Combined-confirmation puck-line and Total results each lose no more than one
  net win.
- Exact-price board impact includes both an actionable promotion and demotion,
  retains at least 25% of each confirmation Moneyline board, and does not worsen
  full-cohort actionable Brier score.
- Frozen current-head replay parity, complete input coverage, zero missing
  exact prices, focused tests, TypeScript, the full model-change gate, current-
  main integration safety, and protected PR checks all pass before publication.

If the historical or either confirmation gate fails, keep r20 live unchanged
and document the result. No cutoff grid may replace this fixed candidate after
results are seen.
