# NHL professional joint-score r3 predeclaration — 2026-09-29

## Objective and scope

Replace the r2 NHL model's line-hugging score construction with a sport-specific
independent scoring model, then apply market evidence as a bounded correction.
Projection and prediction accuracy are the primary objectives. The public card,
labels, layout, three official markets, writer, lease, lock policy, and stakes do
not change.

Candidate releases:

- Model: `nhl_regular_2026_r3_professional_joint_score`
- Calibration: `nhl_regular_calibration_2026_r3_professional_joint_score`
- Decision: `nhl_regular_decision_2026_r3_professional_joint_score`
- Refresh: `nhl_daily_refresh_schedule_2026_09_29_r4_professional_inputs`

Only regular-season game type `02` is eligible. Existing locked rows remain
immutable. The sole writer remains `writeNhlPredictionRecords` under the shared
`prediction_pipeline:nhl` lease.

## Research protocol

MoneyPuck team-game rows are ordered chronologically and construct each feature
row before that game's result is applied. The tournament uses 2022 as warmup,
2023 for score-head training, 2024 for independent tuning, the first 70% of
priced 2025 games for ability/market calibration, and the final 30% of priced
2025 games as untouched holdout. BALLDONTLIE opening odds are joined only after
the independent score forecast exists.

The independent score head uses rolling goals, expected goals, shots, five-on-
five expected goals, power-play/penalty-kill expected goals, shooting and
goaltending residuals, win strength, Elo, home ice, rest, and back-to-back
context. A separately fitted pregame ability-to-win head contributes 45% of the
independent margin while leaving the independently modeled total unchanged. A
joint Poisson score distribution produces Moneyline, Total, and puck-line
probabilities from the same final score means.

The market marriage may use 20% current no-vig Moneyline consensus as a sanity
correction. Total receives zero fixed market-line weight. Verified same-book
movement prefers Circa, Pinnacle, then Bookmaker; money/ticket evidence remains
provider-separated and bounded. These corrections are applied once from the
independent base and never compound across refreshes.

## Acceptance gates

- Improve team-score, margin, and total MAE versus the r2 independent core on
  the exact same untouched holdout.
- Improve total direction and probability calibration without materially
  regressing winner or puck-line direction.
- Preserve one coherent decimal score and make all three sides derive from its
  joint distribution.
- Preserve all five opening-night games and all 15 markets.
- Report every promotion, demotion, and side change; do not flatten the board.
- Use actual paired puck-line quotes, never a Moneyline-inferred orientation.
- Recover every available SharpAPI split cell and retain last-known complete
  provider observations without member-facing freshness copy.
- Pass focused tests, TypeScript, `verify:model-change`, production build,
  current-main integration safety, protected PR checks, and live verification.

Hold or roll back on incomplete coverage, score/side contradiction, a missing
price presented as normal, mixed releases, failed lease/lock behavior, a board
collapse, or a reader snapshot failure.
