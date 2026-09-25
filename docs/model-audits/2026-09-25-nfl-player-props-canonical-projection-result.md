# NFL player props canonical projection presentation — result (2026-09-25)

## Release result

Approved member lifecycle:
`nfl_player_props_member_lifecycle_2026_09_25_r7_canonical_projection`.

The paired NFL prop board now computes one canonical displayed projection as the median of the
finite quote-specific projections at the selected game/player/category/main line. The prediction
badge consumes that same value. Anytime-touchdown ranking and every stored model and market value
remain unchanged.

## Frozen impact

The active Week 3 read-only replay contained 485 ordinary canonical scopes. Before this repair,
12 scopes could display a projection on one side of the line and a prediction badge on the other
because the grade-ranked primary row and first resolver row came from different quotes. After the
repair there are zero contradictions. Nine presentation labels change: five Receptions, two
Passing Attempts, one Passing Completions, and one Rushing Attempts.

Board and tracking impact:

- stored rows added/removed/changed: 0 / 0 / 0;
- promotions/demotions: 0 / 0;
- actionable rows/scopes changed: 0 / 0;
- grades, prices, probabilities, stored projections, stakes, locks, and tracking changed: 0;
- provider calls, database writes, cron cadence, writer ownership, and lease changed: 0;
- member copy, labels, and layout changed: 0.

## Verification

- focused NFL props presentation and snapshot-store contracts: passed;
- TypeScript: passed;
- ESLint: passed;
- `npm run verify:model-change`: passed;
- Next.js 16.2.6 Turbopack production build: passed, including all 108 static pages;
- current-main integration safety, protected PR checks, merge, and production verification remain
  publication gates.

The accuracy model is deliberately unchanged. As of this audit, the settled actionable sample is
29 wins and 30 losses overall, while Over actionables are 6-4 and Under actionables are 23-26.
The active Week 3 release has no settled results yet. Those observations justify continued
release-pure forward evaluation; they do not justify an outcome-informed weight change or a hidden
board reduction.

Rollback is member lifecycle r6 and the preceding resolver. Canonical snapshots, immutable locks,
tracking, and settlement evidence require no rewrite.
