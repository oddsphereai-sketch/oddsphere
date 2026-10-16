# NBA Total disagreement reader r6 — implementation result

Date: 2026-10-16

Status: implemented on the candidate branch; not production until protected PR merge and live verification

## Outcome

The r4 NBA candidate adds one bounded categorical Total correction to the released independent-first
architecture. It does not refit or replace the independent score model and does not restore a scalar
market blend. The correction can act only when two persistent named-book Total number trails each move
at least five points in one direction while the independent Total remains at least five points on the
opposite side of the current line. It preserves the independent residual magnitude across that line and
then reconstructs both team scores from the single final margin and Total.

The frozen audit is `scripts/operator/audit_nba_total_disagreement_reader.py`; the complete threshold,
selection, confirmation, and limitation record is
`docs/model-audits/2026-10-16-nba-total-disagreement-reader-r6-predeclaration.md`.

## Historical evidence

| Metric | 2024-25 baseline | 2024-25 candidate | 2025-26 baseline | 2025-26 candidate |
|---|---:|---:|---:|---:|
| Full-board Total | 588-635 (48.08%) | 607-616 (49.63%) | 634-590 (51.80%) | 644-580 (52.61%) |
| Applied correction cohort | — | 69-50 (57.98%) | — | 47-37 (55.95%) |
| Total MAE | 14.824 | 14.768 | 15.237 | 15.156 |
| Team-score MAE | 9.262 | 9.259 | 9.539 | 9.511 |

The 2024-25 correction cohort remains positive in both chronological halves: 28-22 and 41-28. The
historical market source is a public consensus opening-to-closing proxy, not authentic stored
same-book chronology. Production therefore requires the materially stricter two-named-book rule and
release-pure prospective evaluation. This is a bounded repair, not evidence that every large market
move should override the model.

## Runtime behavior and board-count contract

- Starting margin and Total remain 100% independent-model owned.
- Spread behavior and coherent indirect Moneyline behavior are unchanged.
- Total correction requires a complete reader, two named trails, five-point movement, two-thirds
  persistence, a five-point opposing residual, and all existing freshness, target-exclusion,
  two-sided-coherence, reversal/buyback, pagination, and disagreement gates.
- A qualified aligned read records confirmation but does not move the score.
- Every correction records independent picks, final picks, qualification, application, and the exact
  market effect.
- No row is demoted or withheld merely because the new evidence is absent; fail-closed means the
  existing independent Total remains in force.
- The read-only October 20-21 opening-board rehearsal evaluated 14 games. All 14 had complete reader
  evidence, but zero had a qualified five-point two-named-book Total read. Relative to r3, r4 therefore
  makes zero Total corrections, zero side changes, zero promotions, and zero demotions on the current
  board. That early-cycle no-op is the intended fail-closed result, not a withheld play or flatter board.

## Release and rollback

The runtime family is:

- `nba_professional_unified_2026_10_16_r4_total_disagreement_reader`
- `nba_market_marriage_2026_10_16_r4_independent_first_total_disagreement`
- `nba_grade_policy_2026_10_16_r4_total_reader_probabilities`
- `nba_unified_final_projection_2026_10_16_r3_total_disagreement_reader`
- `nba_professional_market_reader_2026_10_16_r4_total_disagreement_authority`

The existing authoritative NBA writer and `prediction_pipeline:nba` lease remain unchanged. Every
stored locked payload retains exact precedence. Rollback restores only future unlocked computation to
the r3 family on mixed identity, synthetic evidence, lock mutation, unexplained board contraction,
score/pick incoherence, or prospective harm; it cannot rewrite an r4 lock.

## Verification completed on the candidate branch

- the frozen Python selection/confirmation audit reproduced with every confirmation gate passing;
- unified projection, professional reader, candidate, runtime-artifact, site-wiring, and display-reader
  separation tests passed;
- Total-specific five/five boundaries, target exclusion, retail-only rejection, and buyback rejection passed;
- lock-coherence, locked-member precedence, and T-60 lifecycle tests passed;
- targeted ESLint and repository TypeScript checks passed;
- `npm run verify:model-change` passed in full.

Production publication and live post-merge verification remain outstanding until the protected PR is
merged.
