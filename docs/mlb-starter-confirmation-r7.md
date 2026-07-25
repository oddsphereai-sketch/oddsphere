# MLB starter-confirmation repair — r7

Date: 2026-07-25

## Production finding

The r6 production audit found that all current MLB prediction rows had
`mlb_data_completeness.best_angle_allowed=false`. All 15 games still reported
both starters as probable, including KC–DET after both official eight-player
batting orders had been captured.

The feature snapshot intentionally confirms a starter only when the `lineups`
table contains a confirmed `P`/`SP`/`RP` row for the game's assigned pitcher.
The MLB Stats official-lineup overlay wrote confirmed batting-order rows but
omitted the feed's official probable-pitcher row. As a result, the starter
confirmation condition could never become true through the authoritative MLB
Stats path, permanently suppressing data-completeness-gated Best Angles.

## r7 change

- When an MLB Stats feed contains an official batting order of at least eight
  hitters for a team, ingest its accompanying probable pitcher as a confirmed
  `P` lineup row.
- Do not confirm a pitcher before the official batting order posts.
- Preserve the existing player mapping and game/team matching path.
- Keep the existing `prediction_pipeline` sport-scoped lease and the single
  `lineup_watch` writer path.
- Do not change probability heads, thresholds, flip rules, Lean rules, or
  Best Angle promotion rules.

Release identifiers are bumped to public calibration v7, decision release r7,
rule bundle v9, and grade policy v9. Historical releases remain separate.

## Board-count policy

This is a data-contract repair, not a request to manufacture more actionables.
It can only remove the erroneous global starter-confirmation block after
official orders post. Each game must still pass the existing model, price,
market, data-completeness, and promotion gates.

Before deployment, report:

- current release/data-coverage counts;
- current writer/reader actionable counts;
- the number of official starter rows written by the lineup refresh;
- post-refresh `best_angle_allowed` counts;
- any actual promotion/demotion caused by restored confirmation.

If official starters cannot be matched safely, the row remains probable and
the existing Best Angle block remains in place.
