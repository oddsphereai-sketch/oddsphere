# MLB sharp Moneyline source recovery — September 1, 2026

## Scope and predeclaration

The production MLB line collector already requests a bounded generic `/odds`
payload for every resolved event bucket and uses targeted requests when the
generic payload omits full-game Totals or first-inning Totals. The September 1
source audit found a narrower pagination defect: all 15 games had complete
retail Moneyline pairs and the same provider payload exposed Pinnacle/Circa
Totals, but the persisted `lines` table contained zero complete Pinnacle or
Circa Moneyline pairs.

The candidate adds one conditional `market_type=moneyline` recovery request
only when a bucket proves sharp-book main-Total inventory and its generic
payload lacks a complete two-sided Pinnacle, Circa, or Bookmaker Moneyline.
It preserves the existing 100-call invocation cap, multi-bucket dedupe,
alternate-line rejection, team-side identity guard, sole scheduled line
collector, existing `prediction_pipeline:mlb` writer lease, current line and
line-history stores, lock immutability, and the r73 two-natural-cycle action
promotion contract. It adds no cron, provider, writer, table, reader override,
threshold, stake, probability, projection, or side-selection formula.

Because recovered prices can change the exact evaluated offer and therefore a
grade, this is a behavior-bearing source/input release. It is not classified
as a behavior-neutral collection patch. The probability heads and calibration
v27 remain unchanged; the release advances the decision/rule/grade/schema and
Moneyline evaluation-price/source identifiers.

## Frozen read-only impact audit

Command:

`ODDS_PROVIDER=real_api npx tsx --env-file=.env.local scripts/operator/audit-mlb-sharp-moneyline-recovery.ts 2026-09-01`

The audit made one bounded provider pass plus Supabase SELECTs. Both calls to
the authoritative prediction-record builder used `apply=false`; provider rows
were overlaid only in memory. There were zero database, writer, cron, or reader
mutations.

- Slate: 15 games / 45 raw proposed markets.
- Provider budget: 93 calls, below the existing hard cap of 100.
- Provider result: 1,072 accepted rows.
- Persisted sharp Moneyline coverage before: 0 complete book/game pairs.
- Candidate sharp Moneyline coverage: 23 complete book/game pairs across 12
  games (Circa and/or Pinnacle).
- First-inning coverage in the same pass: 56 rows across all 15 games from
  eight retail books. No Pinnacle/Circa/Bookmaker first-inning pair was offered,
  so the candidate makes no false sharp-book first-inning claim.
- Frozen raw board counts before: 1 Best Angle / 12 Lean / 9 Watchlist / 23 No
  Play.
- Frozen raw board counts after: 2 Best Angles / 12 Lean / 10 Watchlists / 21
  No Plays.
- Raw candidate movement: two promotions and one demotion. The established r73
  public action-promotion gate still requires two distinct natural qualifying
  cycles; adverse demotion remains immediate.
- Selected sides and model/market probabilities: unchanged on all 45 markets.
- Moneyline exact-price changes: 11. These are real current named-book offers,
  not synthetic splits or inferred prices.

The raw grade changes were DET@MIN Moneyline No Play to Lean, BAL@COL Moneyline
No Play to Best Angle, SF@PIT Moneyline Lean to Best Angle, and NYY@LAA
Moneyline Best Angle to Watchlist. This is a balanced board impact, not a hidden
flattening release. Started and locked records remain immutable and are not
rewritten by the natural production path.

## Tests and rollback

Required focused checks are `scripts/test-sharpapi-multibucket.ts`,
`scripts/test-sharpapi-speculative-bucket.ts`, `scripts/test-sharpapi-mapping.ts`,
`scripts/test-sharpapi-market-mapping.ts`, `scripts/test-mlb-pipeline-safety.ts`,
and `npm run verify:model-change`, followed by TypeScript, production build,
diff validation, and integration safety against fresh `origin/main`.

Rollback removes only the conditional targeted Moneyline request and restores
r74 / rule bundle v62 / grade policy v52 / schema v7 / evaluation-price policy
v3. Calibration v27, probability heads, split-pair selector v2, correction
policy v23, and action-promotion contract r1 are unchanged in both directions.
