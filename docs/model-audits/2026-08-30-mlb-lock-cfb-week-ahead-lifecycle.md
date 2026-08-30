# MLB lock coherence and CFB week-ahead lifecycle — 2026-08-30

## Authorization and frozen scope

The owner requested immediate production fixes for two observed Daily Edge
lifecycle defects: MLB r73 pending promotions were falsely blocking T-60
coherence, and the CFB member board was empty after the captured opening slate
finished even though the next week's schedule and prices were already
available. This change does not alter projection math, probabilities, sides,
grade thresholds, promotion timing, stakes, or settlement.

Owned runtime files are the existing MLB lock gate/query and the existing CFB
weekly-window, sole writer, member fixture, and strict split client. There is
no new endpoint, provider, writer, table, lease, reader-side grade override,
or manual database write. MLB remains under its current writer paths. CFB
remains one atomic writer under `prediction_pipeline:cfb`.

## MLB predeclaration and behavior

Release: `mlb_lock_coherence_2026_08_30_r2_pending_promotion_tuple`.

The only new passing case is an exact r73 Moneyline upward transition whose
public tuple is intentionally retained while
`daily_edge_action_promotion_stability_2026_08_29_r1` is pending. The internal
candidate must exactly match the fresh proposed side, line, price,
probabilities, edge, publication time, and evaluated-price provenance; the
stored public pick and side must remain unchanged. T-60 freezes the retained
public tuple and never promotes the candidate. Missing snapshot state, an
invalid contract/status/reason, or any candidate/identity mismatch remains a
hard lock block.

Board-count impact is exactly zero: no promotion or demotion is introduced.
The operational impact is that a valid retained tuple can lock instead of
being falsely rejected by a comparator that only understood pre-r73 rows.

## CFB predeclaration and evidence

Releases:

- weekly window `cfb_weekly_window_2026_08_30_r3_completed_slate_roll_forward`
- writer `cfb_forward_evidence_writer_2026_08_30_r29_completed_slate_roll_forward`
- member fixture `cfb_v1_member_fixture_2026_08_30_r31_completed_slate_roll_forward`
- strict split client `cfb_sharpapi_splits_2026_08_30_r2_full_week_capacity`

The Tuesday anchor remains the default. Early rollover is allowed only when
the current window has nonempty evidence, distinct captured games meet the
largest stamped `slateGameCount`, and no captured game has a future kickoff.
Empty/incomplete evidence or any future kickoff retains the current window.
This makes the transition evidence-driven and protects real Monday games.

A read-only BALLDONTLIE inventory at 2026-08-30T15:29:03Z found 132 scheduled
Sept. 3–7 games, 106 model-covered games, 87 FBS-involved model-covered games,
and 78 model-covered games needing Sharp price fallback. The schedule required
seven bounded provider reads. The existing price-fallback cap of 96 is
sufficient. The strict split matcher receives one league response and is
raised from 96 to 128 exact in-memory game identities so the 106-game atomic
wave does not fail before matching. Its 200-row response cap and strict
date/team identity are unchanged.

Visible board impact changes CFB from an expired zero-game reader state to the
next qualified weekly slate after the natural sole-writer cycle. Per-game r43
forecast and grade behavior is unchanged, so no promotion/demotion claim is
made before that natural wave exists. Prior evidence and T-60/tracking rows
remain immutable and release-separated.

## Validation and rollback

Focused tests cover exact pending MLB acceptance plus candidate/side rejection,
complete-slate CFB rollover, incomplete evidence, a future Monday game, and
early next-week fixture selection. Required model/integration safety, TypeScript,
lint, production build, exact-tree PR proof, deployment, natural writer health,
and signed-in reader QA must pass before completion.

Rollback restores MLB lock coherence r1 and CFB window/writer/fixture/split
r2/r28/r30/r1. Existing prediction records and append-only CFB evidence are
not rewritten or deleted.
