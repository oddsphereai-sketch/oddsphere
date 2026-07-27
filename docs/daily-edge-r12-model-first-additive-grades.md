# MLB Daily Edge model-first additive grades — r12

Date: 2026-07-27

## Release

- Public calibration: `mlb_public_calibration_v11_2026_07_27`
- Decision release: `mlb_daily_edge_decision_2026_07_27_r12`
- Rule bundle: `mlb_daily_edge_rule_bundle_v13_2026_07_27`
- Grade policy: `mlb_public_grade_policy_v11_model_first_additive_rules_2026_07_27`
- Tracking contract: `member_facing_lock_v5_release_aware_health_model_first_2026_07_27`

## Problem and correction

The moneyline decision layer had made named historical promotion cohorts the
effective whitelist for Best Angles and most Leans. That inverted the intended
ownership: the calibrated model grade should be the primary path, while
validated market/price rules should add qualified actions.

r12 restores this order:

1. The current calibrated model proposes the grade.
2. Existing confirmation and hard-safety checks can demote it.
3. Existing validated rules can independently promote another qualified play.
4. The final grade and the exact path that produced it are stamped in the
   immutable prediction snapshot.

This applies to MLB moneylines and totals. First Inning already followed the
model-first writer contract and is unchanged.

## Price behavior

There is no universal `-145` Best Angle ceiling.

- The existing tight-market moneyline Best Angle sleeve remains active from
  `-160` through `-131`, inclusive. A qualified `-155` therefore remains a
  valid Best Angle.
- The existing established-price and near-market ladders remain active.
- A calibrated-model Best Angle is not rejected merely because it falls
  outside a named sleeve. It must still survive price availability, model
  probability/EV coherence, projection alignment, line movement, public split,
  correction, and no-bet checks.
- A Best Angle that misses the final Best Angle gate can retain Lean when its
  price, probability, EV, and projection still support actionability.

## Historical current-head audit

The read-only audit
`scripts/operator/audit-mlb-base-grade-restoration.ts` evaluates only rows from
the current probability heads and separates:

- training: 2026-07-11 through 2026-07-17
- validation: 2026-07-18 through 2026-07-22
- untouched holdout: 2026-07-23 through the latest settled date

Audit population at the release check:

- 370 current-head moneyline/total rows
- 336 settled rows
- 22 current unlocked rows

Findings:

- No historical or current moneyline Best Angle was being suppressed solely
  by the named-rule whitelist after the existing confirmation resolver.
- No historical or current moneyline Lean passed the proposed universal
  actionability checks while being suppressed solely by the whitelist.
- The two historical total Best Angles stopped by the existing 70% quality
  gate went 1-1, -0.259 units. r12 keeps that gate.
- The four historical raw total Leans outside the validated profile went 2-2,
  -0.05 units; none passed the complete probability/edge/price safety profile.
- Net current-board impact at audit time was zero. The release corrects the
  architecture without manufacturing Best Angles or Leans on this slate.

The current flat moneyline candidates had concrete reasons: negative priced
EV, model probability below the Lean floor, or both. Existing additive rules
still produced the qualified moneyline Best Angle and Lean.

## Paired actionability and board impact

r12 does not add a new demotion. It restores the primary promotion/retention
path that had been inadvertently replaced:

- calibrated model Best Angle -> Best Angle after confirmation/safety
- calibrated model Lean -> Lean after probability, nonnegative edge, positive
  priced EV, projection, line, split, and correction checks
- validated named rule -> additive Best Angle or Lean

Existing hard demotions remain paired with those retention/promotion paths.
The observed current-board delta was:

- moneyline Best Angles: +0
- moneyline Leans: +0
- total Best Angles: +0
- total Leans: +0

## Health monitor correction

Locked rows are immutable evidence from the release that produced the public
pick. The monitor now checks their projection and probability-head identity,
but does not falsely require historical locked rows to carry the newest grade,
correction, or tracking policy stamp. Unlocked rows must match the full current
contract.

The deterministic reader audit also recognizes an explicitly explained First
Inning Toss-Up/no-actionable-side result as a neutral decision rather than a
missing-explanation critical alert.

## Writer, lease, and rollback

- No writer, cron, refresh, or provider call was added.
- All prediction-writing jobs continue to use the shared sport-scoped
  `prediction_pipeline` lease.
- Historical locked rows are not rewritten.
- Rollback is the prior r11 commit and release identifiers; never reuse the r12
  identifiers for different behavior.

## Required verification

- `npx tsx scripts/test-prediction-record-service.ts`
- `npx tsx --env-file=.env.local scripts/test-daily-edge-model-first-r12.ts`
- `npx tsx --env-file=.env.local scripts/operator/audit-mlb-base-grade-restoration.ts`
- `npm run verify:model-change`
- `npx tsc --noEmit`
- `npx next build --webpack`
- live release, cron/lease, data coverage, board, and reader snapshot checks
