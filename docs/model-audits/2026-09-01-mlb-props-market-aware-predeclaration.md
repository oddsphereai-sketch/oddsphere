# MLB Player Props Market-Aware Forecast Predeclaration

Date: 2026-09-01  
Starting production base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`  
Incumbent bundle: `mlb_props_2026_08_19_r37`

## Defect

The member props writer currently attaches provider-native opening/current movement only after
probability, projection, side, and grade selection. Most hitter forecasts blend only the selected
book's current two-sided probability; one-sided offers can remain structurally unable to receive a
positive monitoring grade even when the offered price has positive economics. Related player-market
movement and strict player-prop split evidence are not forecast inputs. Missing split evidence is
already common and must remain neutral rather than becoming a hold.

## Frozen candidate

The candidate will remain inside the sole existing `refreshMlbPropsBoard` writer and
`prediction_pipeline:mlb` lease. It will add no reader panel, member copy, provider request, table,
refresh path, or stake.

For every exact player/game/market/line before grade selection:

1. Build an all-book current Over probability from complete named-book two-sided prices at the exact
   line. One-sided milestone prices may supply their own exact implied probability but are never
   mislabeled as no-vig pairs.
2. Preserve the existing market-specific independent-model weights. Replace a target book's
   self-referential market anchor with the all-book current anchor for the authoritative forecast.
3. Derive same-book opening/current movement only from the exact provider opening for that named
   book and side. Missing openings and immaterial moves contribute zero. A line move has priority;
   a flat-line price move must be materially directional. The aggregate adjustment is bounded to
   1.5 probability points.
4. Related-market context may contribute only when at least two separately named related markets
   for the same player/game have coherent directional movement. It is bounded to 0.75 probability
   points. Disagreement or missing related markets contributes zero.
5. Public ticket/handle or sharp-book evidence may contribute only when the exact player, game,
   market, line, side, source, and timestamp are present in the supplied prop row. Missing,
   mismatched, or stale evidence contributes zero and never holds the market. The current BDL props
   contract supplies no such fields, so the production expectation is a neutral adjustment.
6. Over and Under remain complementary. The same authoritative probability must supply the
   member projection and every exact-price grade calculation. Projection movement is monotone,
   market-specific, and bounded; it cannot replace sport-specific recent form, pitcher workload,
   lineup, opponent, park/weather, or probable-starter inputs.
7. Exact grade economics use the offered named-book price and a target-book-excluded same-line
   consensus when available. A generic candidate can move only from No Play to Watchlist and only
   with complete inputs, positive EV, positive reference edge, and non-adverse market context. This
   permits a value side below 50% to be monitored without pretending it is the most likely outcome.
8. Lean and Best Angle remain available only through the already validated market/direction sleeves
   and portfolio rules. The historically rejected broad two-sided action policy stays rejected.
   Generic market context cannot create or increase a stake.

## Frozen evaluation gates

- Report paired before/after Best Angle, Lean, Watchlist, No Play, Pending Data, and Research counts
  on the same current snapshot, with per-market promotions, demotions, and action-count change.
- Prove at least one synthetic coherent offer in every supported member category can reach Watchlist
  without weakening the category's certified action ceiling.
- Prove missing openings, related markets, and split evidence are neutral.
- Prove target-book exclusion, named-book two-sided identity, complementary probabilities,
  projection monotonicity, exact-price EV, probable-pitcher/team identity, writer ownership, lock
  precedence, and release ordering.
- Run `npm run verify:model-change`, the full MLB props engine/launch/budget tests, TypeScript,
  focused lint, build, and integration safety against the latest protected main.

The current board population is an audit result, not a quota. If the candidate creates broad action
inflation, hides an incomplete tuple as normal No Play, changes a locked row, or cannot produce a
balanced tested promotion/demotion report, it will not publish.
