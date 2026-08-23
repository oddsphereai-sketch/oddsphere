# EPL Match Result score-head coherence — August 23, 2026

Status: reader-coherence repair; no prediction, probability, side, grade, price,
stake, writer, lock, settlement, or tracking change.

## Incident

The production Newcastle–Liverpool Match Result reader displayed Newcastle as
the club-model forecast and Best Angle at 42.8% (+279), while the score panel
displayed a separate market-informed distribution of Liverpool 1.8 and
Newcastle 1.5. The latter implied Liverpool as the more likely winner. The
reader disclosed that the heads differed, but still placed one model's score
beside another model's pick, which made the prediction appear internally
contradictory.

The root cause was `buildEplDailyEdgePreview`: it retained the club-only
Dixon–Coles probabilities for Match Result but replaced the shared
`soccerProjection.expectedGoals` with the r12 30% club / 70% market-informed
goals projection for every market tab and board card. r12 was validated as a
goals-market display improvement; it was never the source of Match Result
probabilities or grades.

## Repair

The stored member DTO now also carries a `matchResultOutlook` generated from
the exact club-only lambdas that supply the released three-way Match Result
probabilities. Moneyline cards, Quick Read, and the core decision snapshot use
that distribution and identify it as the same model as Match Result. Total and
BTTS retain the r12 market-informed goals context. The cross-market
representative score is no longer substituted into the Match Result view.

Legacy stored member snapshots can predate `matchResultOutlook` even after the
reader deploys. In that state the moneyline card and reader withhold the
separate market-informed goals context and label the same-head score context as
refreshing. They never relabel the fallback distribution as the Match Result
model. The existing three-way probabilities, pick, grade, and price remain
visible and unchanged until an authoritative snapshot contains the new field.

This is a truthful source-selection repair, not a synthesized score and not a
new model head. r16/v21 remain the active releases. Board impact is zero
promotions, zero demotions, and zero changed market decisions.

## Grade audit

The current Match Result policy was replayed chronologically with prior-only
club fitting and exact Football-Data average prices. Coverage was 272 matches
in 2024–25 validation and 342 matches in the untouched 2025–26 holdout.

- All current Best Angles: validation 26–36, -2.90 units (-4.68% ROI); holdout
  26–33, +5.96 units (+10.10% ROI).
- Newcastle-like Best Angles, defined before inspection as a sub-50% forecast
  that disagrees with the market favorite: validation 6–17, -4.73 units
  (-20.57% ROI); holdout 10–16, +5.08 units (+19.54% ROI).
- The cohort is therefore profitable on the latest holdout but fails the
  required season-stability gate. The live grade was not changed.

Demoting that cohort alone would flatten the board. A previously explored
paired promotion cohort passed the two sampled partitions but was selected
from a grid with only 21 validation and 24 holdout actions, so it remains
shadow pending forward T-60 evidence. No unvalidated promotion or demotion is
applied by this reader repair.

## Verification

- `npx tsx scripts/test-soccer-reader-semantics.ts`
- `npx tsx scripts/test-epl-shadow-model.ts`
- `npx tsc --noEmit --pretty false`
- `npm run verify:model-change`
- focused ESLint, production build, integration-safety check, and signed-in
  production visual verification are required before declaring the repair
  live.
