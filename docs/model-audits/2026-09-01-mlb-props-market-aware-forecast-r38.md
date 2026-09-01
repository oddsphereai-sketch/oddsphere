# MLB Player Props Market-Aware Forecast r38

Date: 2026-09-01  
Production base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`  
Incumbent: `mlb_props_2026_08_19_r37`  
Candidate: `mlb_props_2026_09_01_r38`

## Decision

Publish r38. It repairs the ordering defect recorded in the frozen
predeclaration: current/opening and cross-market evidence now participates in
the authoritative player forecast before grade selection, rather than being
attached only after the grade is complete. It stays inside the existing
`refreshMlbPropsBoard` writer, sport-scoped prediction-pipeline lease, snapshot,
tracking, lock, and member presentation contracts.

## Forecast contract

For the exact player, game, market, line, side, named book, and price, r38:

- builds the current market anchor from complete same-line two-sided named-book
  prices, with truthful one-sided treatment for milestone offers;
- excludes the evaluated book from the grade reference so its own quote cannot
  manufacture edge;
- applies bounded same-book opening/current line or price movement and bounded
  coherent related-market movement before grade selection;
- accepts split evidence only from exact, timestamped prop-row fields and treats
  missing or stale evidence as zero;
- keeps Over and Under complementary and derives the decimal projection from
  the same final probability using the model's local probability/projection
  sensitivity, bounded by market family without internal rounding;
- permits a generic side, including a side below 50% occurrence probability,
  to become only a zero-stake Watchlist when target-excluded edge is at least
  one point, exact-price EV is at least 2%, and market context is not adverse;
- leaves Lean and Best Angle authority with the already validated market and
  direction sleeves. No quota, rank fill, generic action head, or new stake was
  added.

The existing injury, lineup, probable-starter, team identity, pitcher workload,
recent-form, opponent, pitch-mix, park/weather, stale-price, and immediate
adverse-context gates remain in their original sport-specific paths.

## No-write production replay

The paired full replay used the live September 1 feed at
`2026-09-01T21:46:39.849Z` with `persist: false`. It made no database,
tracking, lock, or member-snapshot write and passed the publication validator.

| Measure | r37 | r38 |
| --- | ---: | ---: |
| Board rows | 5,683 | 5,690 |
| Identical offer IDs compared | 5,630 | 5,630 |
| Actionable rows | 142 | 166 |
| Actionable promotions | — | 33 |
| Actionable demotions | — | 9 |
| No Play to Watchlist | — | 75 |
| Final probabilities changed | — | 5,169 |
| Projections changed | — | 4,825 |

Evidence coverage in the r38 candidate was 4,709 rows with a target-book-
excluded reference, 1,168 with material exact opening movement, and 2,553 with
coherent related-market movement. The feed supplied zero exact fresh public or
sharp split rows, so split adjustment was zero everywhere as predeclared.

The actionable transitions were balanced rather than one-way: 33 promotions
and 9 demotions produced the net +24 action count. The grade-transition audit
also recorded eight Lean-to-Watchlist demotions and one Lean-to-Research
demotion. New generic Watchlists are tagged
`MARKET_AWARE_VALUE_WATCHLIST`; sampled promotions all carried positive
target-excluded edge and positive exact-price EV.

## Category health

Every populated supported market except Batter Triples had at least one
Watchlist, Lean, or Best Angle on the replay. Batter Triples had 268 rows, but
266 were Research, one was Pending Data, and the sole signal-eligible quote was
a negative-economics No Play at a longshot price; r38 correctly did not fill the
category. The deterministic all-category fixture supplies a coherent positive-
EV, target-excluded offer to every supported category, including triples, and
proves each can reach Watchlist without weakening its certified action ceiling.

Notable current-slate changes included:

- Batter Hits + Runs + RBI actionables: 0 to 5;
- Batter Strikeouts actionables: 3 to 8;
- Pitcher Strikeouts actionables: 2 to 4;
- Batter Stolen Bases positive grades: 12 to 27, all Watchlist;
- Batter RBI positive grades: 221 to 256, with its validated action count
  unchanged at one;
- Batter Home Runs retained all five validated Leans.

## Safety and rollback

Release ordering uses the repository-required immutable identifier format and
per-market versions include
`mlb_props_market_aware_context_2026_09_01_r1`. The writer still constructs
only unlocked/future rows; stored locked tuples remain reader-authoritative and
are not rewritten or reconstructed. Existing lock writer immutability and
reader-precedence regressions remain part of the MLB props engine/launch suite.

Rollback is the r37 code and registry entry. Rollback must not alter any stored
r38 or legacy locked record; readers continue to render the exact locked
payload first.

## Verification

- `npx tsx scripts/test-mlb-props-market-aware-context.ts`
- `npm run test:mlb-props-engine`
- `npm run test:mlb-props-launch`
- `npm run test:mlb-props-full-slate-budget`
- `npx tsc --noEmit`
- no-write operator replay:
  `npx tsx --env-file=.env.local scripts/operator/audit-mlb-props-market-aware-context.ts --date=2026-09-01`

The frozen declaration is
`docs/model-audits/2026-09-01-mlb-props-market-aware-predeclaration.md`.
