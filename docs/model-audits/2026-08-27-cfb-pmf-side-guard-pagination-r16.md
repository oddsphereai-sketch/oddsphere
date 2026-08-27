# CFB PMF-side guard and bounded Sharp pagination — r16

Date: 2026-08-27

Status: production candidate

Scope: CFB prediction/grade coherence and existing-provider ingestion only

## Decision

Keep the qualified independent CFB joint-score PMF, displayed expected and representative scores,
and the frozen r1 composite grade thresholds. Change only the order of operations: the joint PMF
selects the Moneyline, Spread, or Total side at the exact target line first; the existing
market-informed calibrator and exact-price grade policy may then change confidence and grade, but
can no longer silently choose the opposite team or direction. A full future forecast rerun remains
free to change a prediction when its timestamp-valid football and market inputs change, provided
the entire PMF/score/probability/side state is recomputed together.

The same release also makes the existing strict SharpAPI named-book fallback follow a bounded
exact-event pagination cursor. It remains inside the sole leased CFB writer and its existing
96-request whole-run cap; it neither adds a writer nor performs league-wide discovery.

## Frozen historical audit

The side-guard audit selected nothing from the current Week 0/1 board. It replayed the already
frozen r1 policy with a 2023 selection season and repeated 2024/2025 confirmation. The available
archive reconstructs generic pregame lines, not named-book quote timestamps or CLV, so it is used
as a coherence/regression check rather than represented as exact current-price evidence.

- Moneyline Lean after the PMF-side guard: 93 actions, +2.805u, +3.02% ROI in 2024; 21 actions,
  +7.026u, +33.46% in 2025. Both seasons remain positive without their largest win. Weekly-cluster
  bootstrap probability of positive pooled units is 86.17%. The Best Angle subgroup fails because
  2024 is negative, so the guard authorizes no new Moneyline Best Angle.
- Total Lean after the guard: 371 actions, +39.455u, +10.63% in 2024; 432 actions, +5.182u,
  +1.20% in 2025. Both are positive without their largest win; bootstrap probability positive is
  94.36%. The existing Total Best Angle subgroup remains positive in both seasons.
- The reconstructed Spread calibrator produced no coherent confirmation actions after the guard.
  This release therefore adds no Spread threshold or promotion rule. It only prevents a future
  exact-price layer from grading the side opposite the PMF. An already-live aligned Spread action
  may retain its frozen r1 grade; no forecast-opposed Spread action may be created.

The broader r15 independent-PMF policy search remains shadow-only. Its Total lane passed the
declared gates, while Moneyline failed a 2024 log-score gate and Spread failed 2024 proper scores.
No r15 threshold, probability blend, or grade is shipped here.

## Exact current-board replay

A SELECT-only replay read 96 immutable evidence rows for the exact eight-game current window,
made zero provider calls and zero writes, and reconstructed all 24 markets under the new release.

- Prior evaluated board: 2 Best Angles / 3 Leans / 10 Watchlists / 6 No Plays, plus 3 internal
  exact-price exceptions.
- Candidate evaluated board: 2 Best Angles / 3 Leans / 8 Watchlists / 8 No Plays, plus the same
  3 internal exceptions.
- Actionable promotions: 0. Actionable demotions: 0.
- All five current actions remain unchanged: UNC–TCU Over Lean; SJSU–USC Under 60.5 Best Angle;
  Jacksonville State–North Dakota State Spread Lean and Over Best Angle; Hawaii Moneyline Lean.
- Three non-action contradictions are corrected: Sacramento State +9.5 replaces Eastern Michigan
  -9.5; Hawaii +4 replaces Stanford -4; UNLV replaces Memphis Moneyline. Their grades remain
  non-actionable (No Play), so the repair does not hide a flatter actionable board.

Every candidate market side is asserted against the same PMF's probability at its exact evaluated
line. Outcome winner, expected score, representative score, projected margin/total, and market
side remain one coherent football state; the grade layer cannot flip any of them independently.

## Existing-provider pagination proof

A bounded read-only probe of the exact SJSU–USC Sharp event on 2026-08-27 required two pages and
resolved five trusted books at Total 60.5, including target-eligible BetMGM Under -110. No database,
cron, writer, or publication call was made. Moneyline and Spread were absent from that exact
provider response at probe time, so those markets remain explicit incomplete-evidence No Plays
rather than fabricated prices. The test fixture also proves a two-page event can reconstruct
BetMGM Spread -38.5 and Total 60.5 when both are returned, while malformed/repeated cursors and a
fifth page fail closed.

## Version and rollback

- Decision: `cfb_v1_daily_edge_decision_2026_08_27_r9_pmf_side_guard`
- Tuple schema: `cfb_v1_exact_price_decision_tuple_2026_08_27_r3_pmf_side_guard`
- Sharp fallback: `cfb_sharpapi_named_book_fallback_2026_08_27_r2_bounded_pagination`
- Evidence / collector / member / writer: `cfb_forward_evidence_snapshot_2026_08_27_r3_pmf_side_guard` /
  `cfb_forward_evidence_collector_2026_08_27_r6_pagination_side_guard` /
  `cfb_v1_member_release_2026_08_27_r5_pmf_side_guard` /
  `cfb_forward_evidence_writer_2026_08_27_r7_pagination_side_guard`
- Fixture: `cfb_v1_member_fixture_2026_08_27_r6_pmf_side_guard`

Rollback is the prior r7 decision/r2 tuple, Sharp fallback r1, evidence r2, collector r5, member r4,
writer r6, and fixture r5. Immutable rows remain release-scoped and readable during transition;
locked rows and existing official tracking records are never mutated.
