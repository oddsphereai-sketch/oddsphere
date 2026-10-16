# NBA Total disagreement reader r6 — predeclaration

Date: 2026-10-16

Status: owner-directed provisional production candidate; implementation not yet authorized by this document alone

## Owner direction and problem

Daniel Mengel directed Oddsphere to stop repeating the Total diagnosis and repair the final NBA
forecast if a loss-driven rule can improve both picks and score accuracy without restoring the
rejected fixed market blend.

The frozen r3 independent Total is 48.08% on the 2024-25 selection proxy and 51.80% on 2025-26
historical confirmation. Loss forensics show that a large independent edge is not automatically
strong. The most repeatable failure occurs when the current market has already moved materially in
one direction while the independent model remains materially on the other side.

## Frozen candidate family

The reproducible research operator is
`scripts/operator/audit_nba_total_disagreement_reader.py`.

- selection: 2024-25 regular season;
- historical confirmation: 2025-26 regular season;
- starting forecast: released r3 independent-first score and Total;
- historical movement proxy: public multibook consensus opening-to-closing Total movement;
- movement thresholds tested on selection: 2, 3, 4 and 5 points;
- remaining independent-edge thresholds tested on selection: 3, 4, 5 and 6 points;
- action: categorically re-orient the independent residual across the current Total while preserving
  its magnitude;
- minimum selection cohort: 100 applied corrections;
- stability gate: both chronological halves need at least 40 applied decisions and at least 55%
  accuracy;
- score gate: Total MAE must improve and team-score MAE cannot worsen;
- correction gate: corrections must exceed harms.

Candidates are ranked by applied-cohort accuracy only after every gate clears. That frozen process
selects a five-point opposing move plus a still-opposing five-point independent edge. The recipe is
then carried unchanged into historical confirmation.

The confirmation season is release-pure but not epistemically pristine because earlier Oddsphere
audits examined it. The exact production reader is therefore provisional and requires prospective
release-pure evaluation.

## Historical result

| Metric | 2024-25 baseline | 2024-25 selected | 2025-26 baseline | 2025-26 candidate |
|---|---:|---:|---:|---:|
| Full-board Total | 588-635 (48.08%) | **607-616 (49.63%)** | 634-590 (51.80%) | **644-580 (52.61%)** |
| Applied corrections | — | **69-50 (57.98%)** | — | **47-37 (55.95%)** |
| Total MAE | 14.824 | **14.768** | 15.237 | **15.156** |
| Team-score MAE | 9.262 | **9.259** | 9.539 | **9.511** |

The selection correction cohort is 28-22 in its first chronological half and 41-28 in its second.
The confirmation improvement is ten net corrections across 84 changed decisions. Its 95% Wilson
lower bound remains below 50%, so the result is evidence for a bounded provisional correction—not a
claim that the Total reader has proven a stable 56% population accuracy.

## Intended runtime rule

For future unlocked forecasts only:

1. The portable model owns 100% of the starting Total.
2. The target-book-excluded professional reader must be complete and its Total read must be
   `qualified` on two persistent named-book number trails in one direction.
3. Each supporting named-book trail must move at least five Total points from its own opening,
   preserve that direction for at least two-thirds of its observed duration, remain fresh, and pass
   the existing reversal, buyback, two-sided coherence, pagination and book-disagreement gates.
4. The independent residual against the current selected Total must still be at least five points
   and must oppose the qualified reader side.
5. Only then may the final Total residual be re-oriented across the current Total. Its absolute
   magnitude is preserved; no scalar consensus weight is introduced.
6. The corrected Total and existing final margin reconstruct one home score and one away score.
   Those scores own Total side, probability, price evaluation, grade, locks and tracking.
7. An aligned read, insufficient movement, a smaller independent residual, missing evidence, stale
   evidence, reversal/buyback, incomplete pagination, target-book contamination or disagreement
   leaves the independent Total unchanged.

The runtime evidence requirement is deliberately stricter than the historical consensus proxy.

## Planned release family

- model / prediction record:
  `nba_professional_unified_2026_10_16_r4_total_disagreement_reader`
- market marriage:
  `nba_market_marriage_2026_10_16_r4_independent_first_total_disagreement`
- grade policy:
  `nba_grade_policy_2026_10_16_r4_total_reader_probabilities`
- unified point projection:
  `nba_unified_final_projection_2026_10_16_r3_total_disagreement_reader`
- professional reader:
  `nba_professional_market_reader_2026_10_16_r4_total_disagreement_authority`

There remains one authoritative runtime path and the existing `prediction_pipeline:nba` lease.

## Publication gates

Before publication:

1. focused projection tests must prove the five/five boundary, aligned no-op, residual magnitude
   preservation, coherent reconstructed score and unchanged Spread/Moneyline behavior when margin
   does not cross zero;
2. reader tests must prove two persistent five-point named-book Total trails, target-book exclusion,
   freshness, pagination, reversal/buyback and disagreement fail closed;
3. candidate tests must prove one final score owns all market directions and audit effects;
4. locked-record tests must prove exact legacy payload precedence and writer immutability;
5. the exact current board must report every promotion, demotion and side change, including zero;
6. `npm run verify:model-change`, TypeScript, focused NBA tests and integration safety must pass;
7. the protected pull request must be current with `main` before merge;
8. production verification must prove the release tuple, sole writer/lease, evidence coverage,
   coherent score/pick tuples and unchanged locks.

Rollback restores future unlocked computation to the r3 release family on mixed release identity,
lock mutation, synthetic trails, unexplained board contraction, score/pick incoherence or prospective
harm. Rollback cannot rewrite an r4 lock.

## Locked-record boundary

Every stored locked member payload retains unconditional reader precedence. No historical locked
projection, side, probability, grade, price, stake or evidence field may be mutated or reinterpreted.
