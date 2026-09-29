# NFL player props full-family professional model — predeclaration

Date: 2026-09-28
Production base: `5388b1d92a37245b11654d590f4ea3a9d87bc8cf`

## Scope

- NFL player props only.
- Independently evaluate passing attempts, passing completions, passing yards,
  rushing attempts, rushing yards, receptions, receiving yards, and anytime
  touchdown.
- Preserve the existing member copy, labels, layout, canonical one-line surface,
  stakes, lock semantics, and sole writer under `prediction_pipeline:nfl`.
- Existing locked props remain immutable. Any qualified release begins with the
  next unlocked slate.

## Established gap

The September 28 official-outcome release corrected all historical labels and
promoted a confirmed joint quarterback workload head, but it did not improve
the independent point architecture in every prop family. Receiving and rushing
conditional-efficiency candidates were rejected on 2024 confirmation, and the
anytime-touchdown model was retained. The current production runtime therefore
must not be described as a complete full-family model rebuild.

The current independent feature substrate contains player role/history, team
volume, opponent allowance, home field, current-season state, availability,
and team implied points. This audit will test whether chronological additions
for neutral game-script tendency, pace, pressure, efficiency, red-zone usage,
player opportunity quality, venue/weather, and coaching continuity materially
improve each applicable market. Features that cannot be reconstructed before
kickoff and reproduced in the live writer are ineligible.

## Candidate families

1. Independent market-specific point heads, including direct, opportunity-share,
   conditional-efficiency, hurdle, and conservative ensemble candidates.
2. Coherent related-market heads: attempts/completions/yards for quarterbacks,
   carries/rushing yards for rushers, and targets/receptions/receiving yards for
   receivers. Physical and directional contradictions are prohibited.
3. Anytime-touchdown occurrence and within-team scorer-ranking candidates using
   pregame role, red-zone/goal-line opportunity, team scoring environment, and
   opponent touchdown allowance.
4. Target-book-excluded market reading that keeps sharp-reference books distinct,
   evaluates line and price movement, and permits evidence-supported confirmation,
   resistance, or side changes without a fixed cosmetic nudge. Public consensus
   alone cannot masquerade as sharp evidence.
5. Release-pure grade calibration with paired promotions and demotions. A flatter
   board is not an acceptable hidden result.

## Chronology and gates

- Training ends in 2022, 2023 selects, 2024 confirms, and 2025 remains the locked
  historical holdout for point/distribution architecture.
- 2026 settled rows are evaluated only by exact decision release and lock timestamp.
  Stored target-excluded books, opening/current movement, and sharp-book identity
  are required for market-reading claims.
- A candidate must improve or preserve confirmation and holdout point/distribution
  accuracy for its market, remain coherent with related markets, and be reproducible
  from the live evidence path.
- Actionability changes require exact prices, a release-separated replay, paired
  promotions and demotions, market/side/grade counts, and no material board
  flattening.
- No candidate may add provider requests, a per-card fetch, a second writer, or a
  second prediction lease.
- Before publication: focused tests, `npm run verify:model-change`, clean latest-main
  integration proof, protected pull request, production release proof, live reader
  coherence, freshness/coverage, and request-budget verification.
