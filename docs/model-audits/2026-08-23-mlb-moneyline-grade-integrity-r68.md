# MLB moneyline grade integrity r68

Date: 2026-08-23 (final outcome audit rerun 2026-08-24)

Status: release candidate; no push, merge, deployment, writer invocation, cron invocation, or database mutation performed.

## Decision

Ship only the market-scope and serialization defects. Do not loosen the signed SharpAPI money-below-tickets rule, the 60% strong-winner boundary, or the same-book adverse-movement guard. Every predeclared graded/hysteresis alternative missed the frozen confirmation gates.

The release retains every r67 probability, projected score, selected side, evaluated book/price/time, signed-split threshold, movement threshold, grade cohort, stake rule, single writer, lease, and T-60 boundary. Public calibration remains v27. The release stamps are decision r68, rule bundle v56, grade policy v46, and correction policy v20.

## Proven defects

### Cross-market completeness contamination

The card-wide `mlb_data_completeness.status` becomes `incomplete_missing_required_data` when either market lacks a required field. The Moneyline writer used that global status as an action block even when the only missing fields were `over_price` and `under_price`. On the locked CIN@ARI tuple, the Moneyline inputs were complete and the existing tight-market-price Best Angle rule qualified, but missing Total prices caused the final champion action to demote it.

r68 derives the Moneyline block from Moneyline/team/starter fields only. Missing Total-only fields remain visible in the card audit and still block the Total; they no longer suppress Moneyline. Genuine Moneyline/team/starter missing fields continue to fail closed.

### Split grade authority

The writer computed `trackedMlBestAngle` before the final champion action. It then serialized that pre-champion boolean even when the champion action was `no_play`. The locked CIN@ARI row demonstrated the contradiction:

- `play_grade=null`
- `best_angle=true`
- `decision_pipeline.board_action=no_play`
- `decision_pipeline.actionable_grade=null`
- a Best Angle `action_rule_id` remained attached

r68 derives the public Best Angle, actionable grade, action rule, grade source, Best Angle resolution, and recalibration audit from the same final post-champion action. A real Moneyline data hold now produces one coherent non-action tuple; a Total-only gap no longer creates that hold.

Locked rows remain immutable. The repair applies only to later unlocked writer output and future locks.

## Frozen chronological audit

Protocol was committed before opening the settled candidate outcomes in `2026-08-23-mlb-moneyline-grade-hysteresis-predeclaration.md`. The final read-only run loaded 188 unique locked Moneyline rows from August 10-23; all 188 had settled by the August 24 rerun. It used the exact locked selected-side price, stored release/probability-head stamps, same-book movement, verified SharpAPI split pair, grade history, result, and available closing-line field.

Windows:

- development: August 10-14
- validation: August 15-19
- holdout: August 20-22
- August 23: current-board impact, opened only after predeclaration

### Signed resistance cliff

Relaxing the active -10 percentage-point cliff to -15, -20, -25, or -30 recovered the same two prior-action rows. Both were development rows (2-0, +1.502u); validation and holdout each had zero qualifying rows. All four alternatives fail the minimum confirmation sample gates and remain rejected.

### Strong-winner probability floor

These are counterfactual additions among otherwise coherent signed-resistance stand-downs; no applied production actions or releases were blended and called current performance.

| Floor | Settled | W-L | Units | ROI | Development | Validation | Holdout |
|---|---:|---:|---:|---:|---:|---:|---:|
| 60% reference | 16 | 10-6 | -1.601u | -10.01% | 4-5, -3.253u | 5-1, +1.242u | 1-0, +0.410u |
| 58% | 22 | 14-8 | -1.122u | -5.10% | 4-7, -5.253u | 6-1, +1.848u | 2-0, +1.016u |
| 57% | 24 | 16-8 | +0.190u | +0.79% | 5-7, -4.577u | 7-1, +2.485u | 2-0, +1.016u |
| 55% | 29 | 17-12 | -3.100u | -10.69% | 6-9, -5.868u | 7-3, +0.485u | 2-0, +1.016u |

Every alternative fails the frozen gates: development stability is negative, holdout has only one or two actions rather than five, pooled confirmation has fewer than fifteen actions, and available CLV coverage is sparse. The 57% row is also negative after removing its largest win. The active r67 exception remains unchanged.

On August 23, a 58% floor would have promoted MIA -162 (59.3%, signed gap -11, supportive move +1.05pp) and SD -154 (58.2%, gap -34, supportive move +0.79pp). They later went 2-0, +1.267u. That result was unavailable at predeclaration and does not override the failed multi-window gates.

### Adverse movement and combined hysteresis

The 0.5, 1.0, 1.5, and 2.0pp adverse-only tolerances had zero rows satisfying the frozen prior-action, exact-price nonnegative-EV, projection, split, and data conditions. The combined 58% / gap greater than -15 / movement at most 1pp / nonnegative-EV candidate and its prior-action hysteresis variant also had zero rows. No inference is authorized from an empty cohort.

## Paired board impact

The August 23 locked database had two authoritative Moneyline actions and thirteen authoritative nonactions. The reader additionally displayed CIN@ARI as a Best Angle because of the contradictory boolean fallback.

r68's defect-only replay has:

- one authoritative Moneyline promotion: CIN@ARI `no_play` to the already-qualified tight-market-price Best Angle because its only missing required fields were Total prices;
- zero Moneyline demotions;
- zero selected-side, probability, projected-score, evaluated-price, Total, or First Inning changes;
- unchanged visible August 23 Best Angle/Lean count, because the reader was already exposing the stale Best Angle boolean;
- authoritative Moneyline actions 2 to 3 and nonactions 13 to 12 on that frozen board.

The threshold/hysteresis candidates apply zero promotions and zero demotions because they remain shadow/rejected.

## Safety assertions

- A Total-only missing-price audit preserves a complete Moneyline Best Angle and coherent `bet` tuple.
- A genuine Moneyline missing-price audit fails closed with `best_angle=false`, `play_grade=null`, `board_action=no_play`, and null actionable grade/action rule/grade source.
- Existing signed-resistance, strong-winner, movement, price-coherence, T-60, and locked-row behavior remains covered by the focused prediction-record and MLB pipeline suites.

Rollback is r67/v55/v45/correction v19. Rollback must not mutate any already locked row.
