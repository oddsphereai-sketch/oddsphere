# UCL coherent primary score r10

Date: 2026-10-20

## Decision

Advance only future-unlocked UCL rows to
`ucl_goals_coherent_2026_10_20_r10_coherent_representative_score` and primary
score semantic
`ucl_projected_score_2026_10_20_r1_coherent_representative`.

The r9/r5 PMF, market-reading rules, probabilities, sides, exact prices, r13
grades, stakes, providers, cadence, writer, shared `prediction_pipeline:soccer`
lease, tracking, and settlement are unchanged. Existing locked cards and rows
remain their exact stored public record.

## Diagnosed defect

The final r9 PMF already produced one representative exact score constrained to
agree with its Match Result, Over/Under 2.5, and BTTS leaders. The member card's
primary score instead used decimal expected goals. Expected goals are
distribution means and may remain positive because of high-scoring tail
outcomes even when the median categorical forecast is BTTS No.

Roma-Benfica exposed the presentation contradiction:

- final predictions: Roma, Over 2.5, BTTS No;
- decimal distribution means: Roma 3.3089, Benfica 1.0956;
- coherent representative exact score: Roma 3-0.

The PMF was coherent; the primary-score adapter selected the wrong semantic.

## Correction

For an open UCL card, `projected` now uses the existing highest-probability
exact score that satisfies all three final categorical leaders. The same PMF's
decimal means remain in `soccerProjection.expectedGoals` and in evidence rows
explicitly labeled Expected Goals. This is not a hand-authored score change,
market weighting, score haircut, or second model.

A game entering its T-60 locking window captures the coherent primary score
before its tuple becomes immutable. Already locked cards do not enter the new
adapter path; the locked member reader continues to prefer the complete stored
legacy card and its captured projection.

## Same-input current-board impact

The persisted 18-game member snapshot contains 16 open and two locked games.
Applying the fixed semantic gives:

- 16/16 open primary scores agreeing with Match Result, Total, and BTTS;
- zero incoherent open scores;
- zero locked score changes;
- zero side, probability, price, grade, stake, promotion, demotion, or
  actionable-count changes.

Roma-Benfica's primary score becomes Roma 3-0. Its expected-goals evidence
remains Roma 3.3089 and Benfica 1.0956. The distinction is intentional: the
first is the exact-score prediction; the second is the distribution mean.

## Verification and rollback

Publication requires focused UCL production and immutable-lock tests,
TypeScript, the full model-change suite, production build, current-board
coherence, latest-main integration safety, protected PR checks, and live proof
that r10 is present only on unlocked rows. Roll back future-unlocked generation
to r9 if any primary score contradicts a final categorical prediction or any
side, probability, price, grade, stake, locked payload, writer, lease, tracking,
or provider-coverage invariant changes.
