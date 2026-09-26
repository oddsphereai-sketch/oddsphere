# CFB score-side coherence r71

## Predeclaration

- Scope: CFB Daily Edge Spread side selection, exact-price decision/calibration releases,
  market/sharp grade wrapper, sole forward-evidence writer, evidence/member releases,
  member fixture, compact snapshot reader, official tracking, and release registry.
- Incident: the authoritative joint score distribution projected Toledo 27.6–23.3 over San
  Diego State while the member Spread prediction showed San Diego State +2.5. The mismatch
  came from the production-default 53–55% downstream Spread counter-signal, not from the
  score PMF or the market quote.
- Intended behavior: the member Moneyline, Spread, and Total sides must be selected from the
  one authoritative joint score PMF at the evaluated line. The prior counter-signal remains
  callable only through its explicit versioned contract for audit and future upstream model
  research. It cannot be the production default or an exception to publication coherence.
- Unchanged: expected scores, representative scores, PMF cells, Moneyline and Total selection,
  market/sharp inputs, quote choice, thresholds, stakes, copy, labels, layout, cron schedule,
  provider budgets, sport lease, append-only evidence, and immutable T-60 records.
- Sole writer and lease: `/api/cron/cfb-forward-evidence` under `prediction_pipeline:cfb`.
- Safety gates: focused CFB tests, release-transition fallback, outcome-blind current-board
  replay, promotion/demotion/actionable counts, `npm run verify:model-change`, integration
  safety from latest `origin/main`, protected PR checks, and post-merge live release/coherence
  verification.
- Rollback: revert the complete r71/r27/r39/r59/r18 release family to the preceding
  r70/r26/r38/r58/r17 family without modifying immutable evidence or tracking rows.

## Result

- The focused CFB production suite passes, including a direct regression proving that a Toledo
  27.6–23.3 forecast at Toledo -2.5 publishes Toledo -2.5 rather than San Diego State +2.5.
- The September 26 SELECT-only replay used 64 games and 53 evaluable Spreads with zero writes and
  zero provider calls. Moving from the superseded counter-signal to PMF identity changes eight
  Spread sides. The board moves from 24 to 25 actionable Spreads: one promotion, zero demotions,
  and no flattened-board effect. Grade counts move from 0 Best Angles / 24 Leans / 17 Watchlists /
  12 No Plays to 0 / 25 / 16 / 12.
- Production verification remains pending until the protected PR merges and the sole writer
  publishes the complete r71 release family.
