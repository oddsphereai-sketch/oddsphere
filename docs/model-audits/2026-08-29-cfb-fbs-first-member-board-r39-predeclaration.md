# CFB FBS-first member board r39 predeclaration

Date: 2026-08-29

## Problem and scope

The production CFB snapshot contains every model-covered Division I game, but its member landing
board mixes 8 FBS-involved games with 30 FCS-only games. Twenty-four FCS-only games have no
evaluated sportsbook market, so unavailable and No Play cards dominate the first member view even
though every FBS-involved game is present and its reader uses the mature Daily Edge surfaces.

This candidate is restricted to member fixture metadata and presentation scope. It may derive an
`fbs_involved` / `fcs_only` classification from the already-resolved team metadata, open the CFB
board on FBS-involved games, expose all 38 model-covered Division I games through an explicit
control, and preserve direct FCS game links by opening the full scope.

## Frozen authority

- Base production commit: `9fbc81a835053326c5927df87abd92de4d8c451b`.
- Public outcome contract remains `cfb_independent_public_outcome_contract_2026_08_28_r29`.
- Decision and grade releases remain `cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope`
  and `cfb_v1_composite_grade_policy_2026_08_25_r1`.
- Member evidence and writer remain `cfb_v1_member_release_2026_08_28_r20_prior_event_disambiguation`
  and `cfb_forward_evidence_writer_2026_08_28_r25_owner_cadence` under the sole
  `prediction_pipeline:cfb` lease.
- Proposed fixture / presentation / board-scope releases are
  `cfb_v1_member_fixture_2026_08_29_r26_fbs_board_scope`,
  `daily_edge_member_presentation_2026_08_29_r17_cfb_fbs_default_board`, and
  `cfb_member_board_scope_2026_08_29_r1_fbs_default`.

No provider collection, probability, calibration, exact-price decision, grade threshold, stake,
lock, writer, tracking, or settlement behavior is authorized to change.

## Evidence and acceptance gates

The SELECT-only production audit found 466 evidence rows and selected 38 unique current-slate
games / 114 market slots. The selected fixture contains 35 evaluated tuples and 79 explicit
unavailable states: 5 Best Angles / 2 Leans / 11 Watchlists / 17 evaluated No Plays.

The candidate must satisfy all of the following:

1. Every one of the 8 FBS-involved games remains present in the default board; all 38
   model-covered Division I games remain reachable through **All Division I**.
2. Direct links to an FCS-only game remain addressable and open the complete Division I scope.
3. The selected all-Division-I fixture and its exact-price tuples are byte-equivalent apart from
   the added scope metadata.
4. Exact before/after grade counts are reported. Expected result is zero tuple additions or
   removals, zero side changes, zero promotions, zero demotions, and zero net actionable change.
5. `npm run test:cfb-v1-production`, `npm run test:daily-edge-experience`,
   `npm run verify:model-change`, type/build checks, and desktop/mobile reader QA pass.

## Rollback

Restore fixture r25 and shared presentation r16. Immutable evidence, model outputs, exact-price
tuples, locks, and official tracking rows remain untouched and require no rollback.
