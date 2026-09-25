# NFL player props canonical main-line predeclaration — 2026-09-25

## Scope and owner direction

Daniel Mengel directed OddSphere to stop presenting sportsbook alternate ladders as separate NFL
player-prop predictions. The member board must show one current listed market line for each
game/player/category, with the existing paired Over/Under prediction, without new copy, labels, or
layout. This approval explicitly includes already-locked member presentation. Immutable stored
decisions, tracking records, settlement evidence, and exact provider observations must remain
unchanged.

Affected surface: NFL player props member selection and reader grouping. The independent model,
probabilities, projections, grades, stakes, runtime board, tracking, settlement, collection budget,
cron, and shared `prediction_pipeline:nfl` lease are not being changed.

## Current release contract

- Model: `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs`
- Calibration: `nfl_player_props_distribution_calibration_2026_09_24_r10_projection_line_forecast`
- Decision/runtime/board: `nfl_player_props_decision_2026_09_24_r13_projection_line_forecast` /
  `nfl_player_props_runtime_2026_09_24_r14_projection_line_forecast` /
  `nfl_player_props_board_2026_09_24_r17_projection_line_forecast`
- Member/lifecycle/writer: `nfl_player_props_member_2026_09_24_r23_projection_line_forecast` /
  `nfl_player_props_member_lifecycle_2026_09_24_r5_projection_line_forecast` /
  `nfl_player_props_writer_2026_09_24_r26_projection_line_forecast`
- Tracking: `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`

The sole authoritative writer remains `runNflPlayerPropsProductionWriter` under the existing NFL
prediction-pipeline lease.

## Predeclared selection rule

For each game, team, suffix-normalized player identity, and prop category:

1. Preserve all source rows and exact offers in the canonical production snapshot.
2. For every sportsbook, identify its most balanced complete same-line Over/Under pair. This is the
   sportsbook's main-line vote; heavily juiced ladder rungs therefore cannot masquerade as the main
   line merely because they were returned first.
3. Use the cross-book median of those votes as the consensus main-line anchor.
4. Select the actually offered line nearest that anchor, resolving ties by book votes, exact-line
   book breadth, and two-sided price balance.
5. Publish only rows at that one line in the member DTO for every new/unlocked scope.
   Anytime-touchdown retains the ordinary 0.5 line. Player suffix aliases such as `Jr.` are grouped
   for selection and card pairing without rewriting stored identity.
6. A member row that was already locked before this release retains exact reader precedence until
   the established board rollover. A scope selected by this release remains canonical when it later
   locks; no future lock expands back into an alternate ladder.

No provider request, database writer, stored lock, tracking record, price, probability, projection,
grade, stake, or settlement result may be mutated by this member-only selection.

## Acceptance gates

- Exactly one member-visible line per new/unlocked game/player/category, with already-locked legacy
  payloads preserved until normal rollover.
- Both sides remain available when a complete exact pair exists.
- Published prediction remains coherent with projection versus the selected line.
- Zero retained-row grade, price, probability, projection, lock, or stake mutations.
- Frozen before/after report includes total rows, market scopes, actionable rows/scopes, removed
  alternate rows, promotions, demotions, and provider-call/write impact.
- Focused tests, TypeScript, lint, `npm run verify:model-change`, production build, latest-main
  integration safety, protected PR checks, deployment, live release, snapshot freshness, and site
  response all pass.

Rollback is the prior member/lifecycle/writer release family. Rollback must not rewrite locked or
settled evidence.
