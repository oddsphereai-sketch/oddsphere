# NFL evidence-calibrated market integration predeclaration

Status: predeclared production candidate; not approved for publication.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

## Scope

This candidate affects NFL Daily Edge Moneyline, Spread, and Total only through the downstream
market-to-score integration. The paid independent team-score projection remains the immutable
starting opinion. The T-60 lock, provider cadence, target-excluded exact-price selection, stakes,
copy, labels, layout, cron topology, sole prediction writer, and `prediction_pipeline:nfl` lease do
not change.

The affected runtime is the NFL market-evidence outcome, Spread/Total direction, cross-market
winner coherence, target-excluded outcome, joint probability/calibration, decision/grade, member
snapshot, fixture, and sole-writer release family. Existing locked rows retain their complete stored
payload and release tuple.

## Current champion

- Member / model / calibration / decision / grade:
  `nfl_v1_member_release_2026_10_08_r27_named_sequence` /
  `nfl_v1_daily_edge_model_2026_10_08_r24_named_sequence` /
  `nfl_v1_daily_edge_calibration_2026_10_08_r23_named_sequence` /
  `nfl_v1_daily_edge_decision_2026_10_08_r29_named_sequence` /
  `nfl_v1_grade_policy_2026_10_08_r29_named_sequence`.
- Weekly outcome / distribution / probability / representative score:
  `nfl_v1_weekly_paid_team_score_2026_10_08_r12_named_sequence` /
  `nfl_pooled_discrete_residual_distribution_2026_10_08_r11_named_sequence` /
  `nfl_v1_weekly_pooled_discrete_probability_2026_10_08_r11_named_sequence` /
  `nfl_v1_market_evidence_representative_score_2026_10_08_r11_named_sequence`.
- Market outcome / Spread / Total / target exclusion:
  `nfl_v1_market_evidence_outcome_2026_10_08_r12_named_sequence` /
  `nfl_v1_spread_market_direction_2026_10_08_r12_named_sequence` /
  `nfl_v1_total_market_evidence_2026_09_28_r9_market_marriage` /
  `nfl_target_excluded_market_outcome_2026_10_08_r10_named_sequence`.
- Sole writer / context / fixture / compact snapshot:
  `nfl_forward_evidence_writer_2026_10_08_r57_named_sequence` /
  `nfl_daily_edge_forward_context_capture_2026_10_08_r7_named_sequence` /
  `nfl_weekly_member_fixture_2026_10_08_r39_named_sequence` /
  `nfl_forward_member_snapshot_2026_10_08_r31_named_sequence`.

## Failure being corrected

The current Spread direction function takes the independent cover probability's absolute distance
from 50% and reflects it onto the market-selected side. The Total direction function performs the
same reflection with `max(p, 1-p)` / `min(p, 1-p)`, and the Total mean is subsequently reflected
across the line. Consequently, a market disagreement can inherit confidence that belonged to the
opposite independent side.

The current cross-market winner check runs only when a proposed margin crosses zero. It does not
guard a large same-winner margin expansion, even though that expansion can materially inflate the
Moneyline probability and grade.

## Frozen candidate rules

### 1. Evidence-priced directional integration

The method that chooses a market direction remains unchanged: chronological same-book movement,
current de-vigged price, and qualified named-sequence authority retain their current precedence.

After a side is chosen:

- If the market-selected side agrees with the pre-orientation model side, retain the stronger of
  the pre-orientation probability and the target-excluded current de-vigged probability on that
  same side. Confirmation may preserve or strengthen an opinion, but never weaken it by reflection.
- If the market-selected side opposes the pre-orientation model side, derive the new probability
  from the target-excluded current de-vigged price on the selected side.
- If that current price does not itself favor the selected side, use only the minimum directional
  probability immediately across 50%. The movement may still move the shared projected score and
  flip its direction, but it does not manufacture residual betting conviction at the already-moved
  line.
- Solve the Spread margin or Total mean from that evidence-priced probability. Do not reflect the
  old probability or old score distance across the current line.

This rule is symmetric for home/away and Over/Under. It contains a promotion path when confirming
market price is stronger than the independent probability and a demotion path when contrary market
evidence is weaker than the confidence previously transferred by reflection.

### 2. Same-winner magnitude coherence

- Winner-crossing authorization remains unchanged: a proposed new winner requires same-book
  Moneyline price movement plus a qualifying public or named sharp split, or matching named
  Moneyline and Spread sequence authority, with opposing named flow retaining a veto.
- A proposed score that retains the independent winner may freely reduce that winner's margin.
- It may increase the winner's margin by at most 1.5 points without the same Moneyline corroboration.
  The 1.5-point bound is the already released maximum named sharp-evidence score contribution; it
  is not selected from the reviewed game outcomes.
- A larger same-winner expansion is allowed only when the existing cross-market Moneyline
  authorization supports that winner. Otherwise the final margin is bounded at the independent
  margin plus 1.5 points toward the same winner.

### 3. Coherence and immutability

One final joint score distribution continues to own expected score, representative score,
Moneyline, Spread, Total, every probability, and every exact-price grade. No post-score side or
grade patch is allowed. Locked legacy payloads are read exactly as stored and are never recomputed
under this candidate.

## Required evaluation

The candidate is discovered on opened evidence and therefore will not be described as a pristine
holdout. The report must nevertheless show, by locked timestamp and original release:

- every actual stored decision versus the counterfactual candidate decision;
- every score, side, probability, and grade change;
- corrections, harms, promotions, demotions, and actionable count by market;
- exact stored-price units/ROI, Brier score or log loss, grade monotonicity, team-score/margin/Total
  MAE, and upset detection;
- the complete loss ledger and matched-win ledger, including the previously identified Total Best
  Angle losses and DET-CAR magnitude failure;
- chronological segment results and uncertainty limitations;
- current-board zero-write impact, release coherence, coverage, and locked-reader precedence.

No threshold may be changed after viewing these results without a new dated predeclaration. A live
proposal requires focused tests, `npm run verify:model-change`, a clean committed worktree,
latest-main integration safety, a protected pull request, explicit owner approval of the measured
board impact, and post-deploy release/writer/lease/coverage/reader/lock verification.
