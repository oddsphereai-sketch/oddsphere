# NFL availability margin residual r1 — frozen predeclaration

Date: 2026-10-19

Status: research-only challenger. This release cannot write predictions, grades, stakes,
tracking records, member snapshots, or locked payloads.

## Problem and invariant

The production r11 independent score is a market-free team-strength model. The forward writer
collects exact-game injury evidence and resolves the expected quarterback, but r11 does not consume
either input. The separate target-excluded market reader remains healthy and must remain unchanged;
it is not required to reverse an independent forecast merely because an injury exists.

This tournament asks one narrow question: can a bounded, market-free availability residual improve
the r11-style margin before the existing market reader runs? Total, probabilities, market rules,
grade rules, promotion rules, and every locked row remain unchanged during research.

## Chronology

- Source: checksum-pinned 2016–2026 nflverse schedule, play, roster, snap, and injury files.
- Every feature row is frozen before the complete game week updates team or quarterback state.
- The r11-style baseline is fit only on seasons earlier than the season being predicted.
- Residual-development rows: out-of-season baseline predictions for 2017–2020.
- Architecture selection: 2021 only.
- Final confirmation: 2022 only. No 2022 result may change the selected recipe.
- 2023–2025 and completed 2026 are opened stress windows only. They cannot rescue a failed 2022
  confirmation or select a different recipe.

The previously opened 2024–2026 injury diagnostics motivated a new version and are not represented
as untouched evidence. Reserving 2022 as the final confirmation window prevents those diagnostics
from choosing the candidate.

## Frozen baseline

The baseline is the production margin architecture: the strict provider-reproducible football
feature set and the fixed 96-tree Extra Trees recipe. For each predicted season it is trained only
on earlier seasons. No sportsbook line, price, movement, split, outcome from the predicted season,
team identity, or current-game completed-game quarterback identity is allowed.

## Frozen availability residual

The residual target is `actual home margin - baseline home margin`. Inputs are limited to pregame
availability fields already present in the frozen feature table:

- home-versus-away raw and prior-snap-weighted injury burden;
- out counts and injury-report counts;
- last-known starting-quarterback designation severity;
- prior starting-quarterback EPA, CPOE, sack rate, turnover rate, and dropback history, attenuated
  by that quarterback's designation severity toward a neutral replacement prior;
- roster and coach continuity; and
- missing-value indicators created by the imputer.

The residual has no team-strength, betting-market, score-outcome, team-name, or season-identity
input. Candidate estimators are Ridge regressions with frozen penalties 30, 100, and 300. The 2021
selector also chooses a residual multiplier from 0.25, 0.50, 0.75, and 1.00 and an absolute cap of
2, 4, or 6 points. Selection minimizes all-game margin MAE, then RMSE, then smaller multiplier,
smaller cap, and stronger regularization.

The selected recipe is refit on all prior out-of-season residual rows before each later season. The
candidate margin is `baseline + clipped residual`. Home and away scores remain coherent by moving
the margin around the unchanged independent Total.

## Gates

The candidate may advance beyond research only when all of the following hold:

1. 2022 all-game margin MAE and RMSE both improve over the baseline.
2. 2022 games with a designated last-known starting quarterback contain at least 12 games and their
   margin MAE improves.
3. 2022 Moneyline and Spread direction do not both regress, and neither loses more than one net win.
4. Combined 2023–2025 stress margin MAE does not regress by more than 0.05 points and completed 2026
   stress margin MAE does not regress by more than 0.10 points.
5. The correction remains finite and bounded for every row, preserves coherent scores, and uses no
   market input.
6. A same-input complete-product replay keeps the existing target-excluded market reader unchanged,
   attributes every correction and harm, reports promotions and demotions by market, and does not
   flatten the actionable board.
7. Runtime parity, release bumps, immutable-lock tests, focused tests, `npm run verify:model-change`,
   latest-main integration safety, protected PR checks, and post-deploy release/data/lease checks all
   pass.

Failure at any gate leaves production unchanged. A useful but unconfirmed signal may be retained in
shadow diagnostics for future prospective evidence; it cannot silently alter a live forecast.

