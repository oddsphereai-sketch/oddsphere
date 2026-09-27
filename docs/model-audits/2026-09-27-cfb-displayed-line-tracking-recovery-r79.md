# CFB displayed fallback-line tracking recovery r79

## Scope and predeclaration

- Sport / markets: CFB official tracking completeness only.
- Sole write path: `runCfbForwardEvidenceWriter` under the existing
  `prediction_pipeline:cfb` lease.
- Previous releases: writer r78 / official tracking r28.
- Candidate releases: writer r79 / official tracking r29.
- Incident boundary: the September 26 ET CFB slate contains 100 immutable Moneyline records but
  only 98 Spread and 98 Total records. The prior audit correctly rejected lines that did not exist,
  but its planned denominator looked only at `market.current` and missed complete paired fallback
  lines already retained in `market.displayBooks ?? market.currentBooks` for member display.

## Immutable evidence and intended repair

Southern–Jackson State (`providerGameId=459546`) had two strictly matched pregame fallback books:

- oneXBet: Jackson State -20.5 and Total 55.5, both -115, observed
  `2026-09-26T22:09:52.213Z`;
- BetOnline: the same lines and prices, observed `2026-09-26T22:09:41.781Z`.

Both observations belong to SharpAPI event
`ncaaf_jacksonstatetigers_southernjaguars_2026-09-26_b3`, preceded the immutable T-60 capture at
`2026-09-26T22:10:15.287Z`, and preceded kickoff at `2026-09-26T23:00:00.000Z`. The immutable
independent PMF hash is
`38562c8fe254646d9e7e6cf2027f47e20bd5c7755cf0f173c0e2247a35997039`.

The writer may append one Spread and one Total accuracy-only No Play record only after replaying
that exact independent PMF and matching its stored hash, probabilities, means, representative
score, and intervals. It evaluates the real representative line but never promotes the fallback
price into executable economics. American odds, market probability, edge, EV, recommendation,
stake, and ROI remain null.

Prairie View–Grambling (`providerGameId=459545`) had no Spread or Total in any of 58 stored pregame
evidence snapshots, canonical line row, line-history row, or stored member card. It remains
Moneyline-only. The correct post-repair denominator is therefore 100 Moneylines, 99 Spreads, and
99 Totals—not an artificially flat 100/100/100.

## Product and model impact

- Forecast / PMF / score / probability / prediction side changes: 0.
- Best Angle / Lean promotions and demotions: 0 / 0.
- Actionable, stake, and ROI changes: 0.
- Member cards, copy, labels, layout, prices, lines, splits, and provider calls: unchanged.
- Historical tracking effect: append exactly two previously omitted real-line accuracy records;
  delete or rewrite no immutable record.

This selection is based exclusively on immutable pregame evidence. The finished score is not an
input to line selection, side selection, probability calculation, or record construction.

## Verification and rollback

- Focused tests prove deterministic representative-line selection, exact-event containment,
  paired-line coherence, pre-capture and pre-kickoff timing, exact PMF replay, null economics,
  wrong-event/post-capture rejection, and continued Moneyline-only behavior when no line exists.
- Required gates: focused CFB production tests, TypeScript, lint, `npm run verify:model-change`,
  production build, integration safety, protected PR checks, and live 100/99/99 denominator proof.
- Roll back writer/tracking constants to r78/r28. Existing append-only records remain intact.
