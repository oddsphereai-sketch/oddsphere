# NFL player props canonical projection presentation — predeclaration (2026-09-25)

## Scope and owner direction

Daniel Mengel reported that an NFL player-prop card can display a projection below its listed line
while labeling the prediction Over. The member product must present one understandable prediction
for the already-selected canonical market line, without new copy, labels, or layout changes.

This is a member-presentation coherence repair. It does not change a stored model projection,
probability, side quote, grade, price, expected value, stake, lock, tracking record, settlement,
provider call, writer, cron, or lease. Accuracy-model changes remain subject to a separately
predeclared release-pure forward evaluation.

## Current release contract

- Model/calibration: `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` /
  `nfl_player_props_distribution_calibration_2026_09_24_r10_projection_line_forecast`
- Decision/runtime/board: `nfl_player_props_decision_2026_09_24_r13_projection_line_forecast` /
  `nfl_player_props_runtime_2026_09_24_r14_projection_line_forecast` /
  `nfl_player_props_board_2026_09_24_r17_projection_line_forecast`
- Member/lifecycle/writer: `nfl_player_props_member_2026_09_25_r24_canonical_main_line` /
  `nfl_player_props_member_lifecycle_2026_09_25_r6_canonical_main_line` /
  `nfl_player_props_writer_2026_09_25_r29_team_boxscore_capture`
- Tracking: `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`

The sole writer remains `runNflPlayerPropsProductionWriter` under
`prediction_pipeline:nfl`.

## Predeclared repair

For an ordinary Over/Under player/category/main-line pair, the member board will derive one
canonical displayed projection from the median of every finite quote-specific projection in that
pair. With the ordinary complete two-side pair this is the midpoint of the Over-row and Under-row
projections. The prediction outcome is that canonical projection versus the selected line; the
existing side probability is used only when the canonical projection exactly equals the line.

The full-board projection cell and prediction badge will consume that same canonical value.
One-sided filtered views retain the available row's projection and may infer an unquoted outcome
without falsely highlighting a missing price. Ranked anytime-touchdown semantics are unchanged.

## Frozen production replay and gates

The read-only Week 3 replay at the active September 25 release has 485 ordinary canonical scopes.
The existing code produces 12 projection/badge contradictions because the grade-ranked primary
row and first resolver row can be different sides. The declared median rule reduces this to zero.
It changes nine presentation labels (five Receptions, two Passing Attempts, one Passing
Completions, and one Rushing Attempts), changes no stored row, and leaves every grade/actionable
count identical.

Acceptance requires:

- zero full-board projection/prediction contradictions;
- zero stored-row, grade, promotion, demotion, actionable, price, lock, tracking, or stake changes;
- unchanged copy, labels, layout, provider budget, cron, writer, and NFL lease;
- focused tests, TypeScript, lint, model-change verification, build, current-main integration
  safety, protected PR checks, merge, and live site proof.

Rollback is member lifecycle r6 and the preceding presentation resolver. Stored and locked
evidence remains untouched.
