# CFB directional joint-PMF r19 predeclaration

## Launch defect

The 2026-08-28 natural writer identified UC Davis at Portland State
(`providerGameId=458220`) with a football-only discrete PMF whose expected score was
UCD 26.4857 / PRST 26.6615 while its same-PMF home win probability was 49.4488% and
its reachable representative score was UCD 27 / PRST 26. The mean and win-frequency
directions crossed because football-score quantization acted on a wide empirical
residual distribution. Allowing that near-even crossing through the coherence gate
did not make the member prediction logically aligned.

## Predeclared candidate

Only the dynamic CFB weekly joint-PMF builder is eligible to change. Frozen launch
forecasts and the residual sample remain fixed.

1. Build the existing empirical, football-score-quantized joint distribution.
2. Select its model winner from win probability; if probability is exactly 50%, use
   expected margin, then the raw score center, then home as a deterministic final
   tie-break. Football does not emit a Toss-Up prediction.
3. When expected-margin direction and winner-probability direction disagree (or are
   exactly tied), move the raw home and away score centers symmetrically in the
   selected winner's direction in the smallest 0.025-point increment that makes both
   directions agree. The raw total center is unchanged. The search is capped at one
   point per team and fails closed if no coherent PMF exists inside that bound.
4. Rebuild expected scores, margin, total, win probability, representative score,
   intervals, and market probabilities from that one corrected joint PMF.
5. Restore the shared football coherence gate to strict directional identity. No
   near-even or Toss-Up exception remains for NFL or CFB.

## Acceptance gates

- Game 458220 must favor UCD in expected score, win probability, and representative
  final from one PMF.
- PMF mass and expected-score/margin/total identities must remain exact.
- Current CFB replay must report all game/market dispositions and exact grade
  promotions/demotions. Any changed actionable grade requires a paired tested rule;
  otherwise the candidate does not publish.
- Current NFL coherence tests must remain strict and green.
- Model, distribution, probability, representative-score, decision, evidence,
  writer, member, fixture, and shared coherence identifiers must be versioned.
- Focused tests, `npm run verify:model-change`, TypeScript, webpack build,
  integration safety, protected PR checks, natural-cycle evidence, and signed-in
  live QA are required.

No provider call, production writer call, database write, second writer, reader-side
override, market-copy prediction, or lock/tracking mutation is authorized by this
candidate.

## Release-boundary defects found during the replay

The SELECT-only full-slate replay exposed two independent writer/member defects
that must ship in the same recovery release:

1. The r7 writer hashed an optional `undefined` object property as JSON `null`,
   while Postgres JSONB omitted that property. The r8 serializer must hash the
   exact JSON-serializable shape and retain a narrowly r7-scoped legacy verifier
   so the immutable 20:09 ET transition wave remains readable without mutation.
2. The writer used scheduled run start as `evaluatedAt` even when a bounded Sharp
   response completed seconds later. The immutable payload capture/evaluation
   timestamp must be the latest real provider observation included in that
   payload, with T-60 lag recomputed from that same timestamp. This is timestamp
   coherence, not stale-quote tolerance: a quote after the final capture time
   remains unavailable.

Acceptance therefore also requires the current 38-game weekly board to remain
readable and SJSU-USC's verified Spread/Total tuples to evaluate normally after
their actual observation time. Moneyline remains unavailable unless a coherent
two-sided target quote exists.
