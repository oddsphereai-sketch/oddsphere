# CFB next-window seed priority — writer r80

## Scope and production observation

- Sport/model: CFB Daily Edge; no forecast or calibration math change.
- Sole writer: `cfb_forward_evidence_writer_2026_09_28_r80_next_window_seed_priority`.
- Lease and schedule remain the existing `prediction_pipeline:cfb` writer path.
- At 2026-09-28T13:59:11Z, the current September 24–28 window contained 106
  distinct captured games, all already started, but only 100 distinct
  opening-stage rows. Its collection need therefore remained
  `opening_incomplete`.
- The adjacent October 1–5 window contained zero evidence and correctly
  reported `opening_seed`. The Sunday overlap exposed both windows, but the
  equal-priority stable sort always selected the old window first. Its capture
  plan was empty, so successful scheduled runs made zero provider calls and
  never seeded the next slate.

## Repair

The existing window selector now orders the one-time adjacent
`opening_seed` ahead of `opening_incomplete`. T-60 captures, release refreshes,
and reference-line completion remain higher priority. Once the adjacent seed
exists, the sole writer resumes its ordinary priority and cadence behavior.
No second writer, schedule, lease, reader, provider hierarchy, or member-facing
surface is added.

## Model-change safety impact

- Forecasts, PMFs, projected scores, probabilities, sides, prices, grades,
  promotions/demotions, stakes, and tracking semantics are unchanged.
- Already-published board impact: 0 promotions, 0 demotions, 0 actionable
  changes, and 0 side changes.
- The change restores publication coverage only; new-week outputs still come
  from the same authoritative CFB model and market pipeline.
- Rollback is writer r79. Existing immutable evidence and locks are preserved.

## Required proof

- Focused weekly-engine and CFB production tests.
- `npm run verify:model-change` and integration-safety verification against the
  latest remote `main`.
- A zero-write production dry run must select `opening_seed` for October 1–5.
- After protected-PR merge, the sole scheduled writer must publish the adjacent
  window; the compact member snapshot must contain upcoming October 1–5 games,
  remain release-coherent, and keep the existing member presentation unchanged.
