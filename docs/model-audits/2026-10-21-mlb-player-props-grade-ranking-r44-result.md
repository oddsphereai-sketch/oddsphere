# MLB Player Props grade-ranking r44 result

Date: 2026-10-21
Base: `c9098cdc3d98ee660a41a9869e4be09e0189af28`
Predeclaration:
`docs/model-audits/2026-10-21-mlb-player-props-grade-ranking-r44-predeclaration.md`

## Decision

Release `mlb_props_2026_10_21_r44`. The current model/market marriage remains
authoritative; r44 corrects only the relative Best Angle / Lean ranking for
future unlocked rows.

## Evidence

The release-pure r43 actionable record is 412-271 (60.3%), but the incumbent
ladder is inverted: Best Angles are 20-23 while Leans are 392-248.

The paired r44 ranking rule has independent chronological support:

| Lane | r42 selection | r42 untouched confirmation | r43 forward |
| --- | ---: | ---: | ---: |
| Promote Runs Scored Under at -200 or better | 51-28 | 44-17 | 50-27 |
| Rerank HRR Under Best Angle to Lean | 9-5 | 6-7 | 8-12 |
| Rerank Pitcher Strikeouts Over Best Angle to Lean | 2-2 | 4-5 | 6-9 |

The promotion is not a count quota. A row must first clear the existing full
model, target-excluded market, exact-price, lineup, research, freshness,
projection-side, and actionable-grade gates. The existing `-200` premium-price
ceiling still applies.

## Behavioral boundary

- side changes: zero
- projection/probability changes: zero
- price/edge/EV changes: zero
- stake changes: zero
- actionable promotions/demotions: zero; these rows remain actionable
- Best Angle/Lean ranking changes: evidence-qualified only
- locked-row changes: zero

The new focused immutability/economics test passed, the 404-check MLB Props
engine suite passed, market-model ownership passed, TypeScript passed, and
repository-wide `npm run verify:model-change` passed.

Rollback is r43 for future unlocked scoring only. No stored lock may be
rewritten or reinterpreted.
