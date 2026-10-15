# CFB T-60 priority and tracking-failure isolation

Date: 2026-10-14

## Scope

This is a lock-lifecycle reliability release. It does not change the CFB score
model, PMF, market reader, forecast side, probability, projection, exact price,
grade, promotion, demotion, or stake. Existing locked and historical payloads
remain immutable.

## Production incident evidence

The October 13 and October 14 lock failures had two independent causes:

1. `cfbForwardReleaseRefreshNeed()` could select
   `reference_line_completion_due` before an ordinary `t60_due` need was
   honored. The specialized reference filter then removed a due T-60 plan when
   that game did not also need reference completion.
2. Official tracking ran before compact member publication. An ineligible
   legacy recovery candidate could therefore throw after evidence append and
   prevent the current member snapshot from publishing.

Read-only production reconstruction proved that WKU-Sam Houston had a valid
T-60 plan at 2026-10-14T23:09Z with approximately 9.8 minutes of lag, but the
window selected `reference_line_completion_due`; the first stored T-60 arrived
at 23:39Z and was correctly held as late. The October 13 affected game followed
the same priority pattern, with opening-completion work visible at the first
eligible cycle.

The legacy candidate eligibility defect was separately corrected by tracking
release `cfb_official_tracking_record_2026_10_14_r48_legacy_recovery_candidate_isolation`.
This release adds structural failure isolation so any future bad historical
candidate cannot block current lock publication.

## Repair

- Scan for and select due T-60 locks before incomplete-opening work.
- Resolve `t60_due` ahead of release refresh, reference completion, and
  provider seeding.
- Preserve all T-60 plans through specialized reference/provider filters.
- Run the same sole leased writer every five minutes, creating multiple
  attempts inside the existing 20-minute validity window. Collection planning
  still decides whether a provider call is due, so the schedule is not a
  provider hot loop.
- Publish the compact member snapshot immediately after append-only evidence,
  before official tracking.
- Catch tracking-stage exceptions, expose `official_tracking_failed:*`, and
  retry idempotently on the next cycle instead of aborting the live lock.

## Safety invariants

- One writer: `/api/cron/cfb-forward-evidence`.
- One shared lease: `prediction_pipeline:cfb`.
- T-60 maximum lag remains 20 minutes.
- No historical row is updated, deleted, relabeled, or promoted.
- Existing locked payloads retain exact reader precedence.
- Official tracking eligibility and record contents are unchanged.
- Prediction and board impact: 0 sides, 0 scores, 0 probabilities, 0 prices,
  0 grades, 0 promotions, 0 demotions, and 0 actionable-count changes.

## Validation gates

The focused CFB production suite must prove:

- due T-60 outranks incomplete openings;
- due T-60 outranks reference/provider refresh;
- specialized filters retain T-60 plans;
- tracking exceptions return health telemetry instead of throwing;
- exactly one CFB writer remains scheduled at five-minute cadence;
- all existing PMF, score, market-reader, tracking, immutability, and normal
  reader contracts remain green.

The repository-wide model-change verifier and integration-safety verifier must
also pass from a clean, current-main worktree before publication.

## Rollback

Restore writer r120 and the prior cron schedule together. Preserve every
append-only evidence row, member snapshot, and prediction record. Never rewrite
or reinterpret a locked payload during rollback.
