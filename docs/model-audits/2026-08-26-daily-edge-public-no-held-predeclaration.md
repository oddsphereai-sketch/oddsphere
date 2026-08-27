# Daily Edge public No Play health contract predeclaration

Date: 2026-08-26

Status: frozen before implementation

## Scope

Affected member presentation: the shared Daily Edge board and reader used by MLB, WNBA, NFL, CFB, Soccer/EPL, NBA, and NHL.

Affected CFB runtime integration: the existing single `prediction_pipeline:cfb` leased writer, strict exact-event Sharp price fallback, member adapter, and market-scoped T-60 tracking boundary.

Unaffected behavior: every sport's model probabilities, projections, selected sides, calibrated thresholds, actionable grades, stakes, settlement, provider call budgets, immutable prior rows, and sport-scoped writer ownership. The NFL and Soccer/EPL probability and grading runtimes do not change.

## Frozen public contract

- Member-facing Daily Edge has no `Held` verdict, badge, filter, card, or reader state.
- An internally held market presents as `No Play` with a concise explicit reason. The internal health flag and reason remain available to the authoritative writer/operator.
- The model-owned outcome forecast is always visible for every operational-exception class: predicted winner/side, outcome probability, projected score, and same-distribution context are never removed by Bet-grade health. This does not authorize inventing a forecast when the model has emitted none.
- A market without a coherent evaluated sportsbook tuple has no evaluated price, fair probability, probability gap, EV, or actionability value. A separately labeled current quote may remain market context but cannot be presented as the evaluated Bet-grade tuple.
- A `No Play` caused by internal health is not relabeled as evaluated EV. The member reason must say what is missing: starter/player availability, coherent exact price, market integrity/freshness, or another explicit integrity input.
- For SJSU-USC, Moneyline presents `No Play` with reason `No coherent two-sided moneyline is currently available.` Spread and Total remain independently evaluated from coherent exact named-book tuples.
- Internal held/unavailable siblings cannot block coherent markets at T-60. Tracking stays market-scoped, exact-price, regular-season/date gated, at most 20 minutes late, immutable, and idempotent.
- No price is synthesized and no reader-side re-evaluation or grade override is permitted.

## Release boundary

The shared member presentation receives a new inspectable release identifier. CFB provider/decision/member/writer releases retain the already-predeclared strict Sharp fallback versioning, and football tracking receives its already-predeclared market-scoped versioning. The final integration must update `docs/current-model-releases.md` in the same commit and preserve one authoritative writer per sport.

## Required evidence

1. Cross-sport tests prove an internal hold presents as `No Play` with an explicit reason for NFL, CFB, Soccer, MLB, WNBA, NBA, and NHL while preserving the model-owned outcome forecast and projected score.
2. Tests prove writer-owned `held`, grade, verdict, and exact-price fields are not mutated by presentation.
3. Held is absent from member filters and public copy.
4. Held markets do not display evaluated market probability, gap, EV, actionability, or evaluated sportsbook price.
5. CFB tests prove SJSU-USC Moneyline has no synthetic tuple, displays the exact public reason, and cannot block independently coherent Spread/Total evaluation or T-60 tracking.
6. Frozen current-board comparison reports public count migration separately from writer-grade changes.
7. Focused tests, `npm run verify:model-change`, webpack build, diff check, and integration safety pass from current protected main.
