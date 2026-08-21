# NFL preseason dry-run decision r9

Date: 2026-08-20  
Scope: local NFL Daily Edge only  
Decision release: `nfl_regular_pipeline_preseason_dry_run_decision_2026_08_20_r3`  
Production/tracking impact: none

## Product failure corrected

The r2 preseason reader mechanically prohibited every Lean and Best Angle. Its
31 Watchlist / 17 No Play distribution therefore did not exercise the actual
Daily Edge decision product. It also applied a regular-season scoring baseline
to preseason totals without a phase check, creating 16 Over directions.

r3 removes the hard grade cap. The regular-season r3 projection remains the
core. The separate preseason model is not allowed to replace it because that
model failed its 2025 side holdout; it is used only as a comparison/veto and
conservative shrinkage input during the untracked preseason rehearsal.

## Decision contract

A market can enter the dry-run weekly portfolio only when:

1. the regular-season core and preseason phase comparison both support the
   same priced side relative to the no-vig market;
2. their selected-side probabilities are no more than 14 percentage points
   apart;
3. the conservative lower model probability is shrunk 65% toward the no-vig
   market probability;
4. exact expected value at the current offered American price is at least 2%;
5. a provider availability snapshot is present;
6. at least two verified same-book price observations are stored; and
7. the market ranks inside the top five eligible rows with no more than one
   action per game.

The portfolio publishes Lean only. Best Angle requires stronger verified
market/participation evidence that is not available for this preseason slate.
Preseason rows remain permanently ineligible for official settlement, results,
stakes, and the pre-existing NFL lifetime record.

## Current board impact

The refreshed BALLDONTLIE snapshot is `2026-08-20T16:11:48.562Z`. It contains
16 real games, 48 predictions, complete availability, and at least three stored
same-book FanDuel observations for every game.

| Grade | r2 | r3 |
|---|---:|---:|
| Best Angle | 0 | 0 |
| Lean | 0 | 5 |
| Watchlist | 31 | 9 |
| Caution | 0 | 0 |
| No Play | 17 | 34 |

The five dry-run Leans are:

| Game | Market | Current price | Risk-adjusted probability | Exact EV | Score |
|---|---|---:|---:|---:|---:|
| LV at HOU | HOU moneyline | -108 | 53.7% | +3.4% | 57 |
| CAR at JAX | JAX +1.5 | -110 | 53.6% | +2.4% | 56 |
| BUF at CLE | BUF +2.5 | +102 | 51.3% | +3.6% | 57 |
| NO at LAR | LAR +2.5 | +100 | 53.9% | +7.8% | 64 |
| CHI at CIN | Over 36.5 | -110 | 53.4% | +2.0% | 55 |

This is five local dry-run promotions and no official promotion or demotion.
The No Play increase is intentional: cross-model disagreement and non-positive
exact-price EV now fail rather than remaining generic Watchlist.

## Verification

- `npx tsx scripts/test-football-product-preview.ts`
- `npx tsc --noEmit --pretty false`
- focused ESLint for the reader, fixture, decision policy, and test
- local browser verification of the 5 / 9 / 34 board and expanded HOU reader
- `npm run verify:model-change` — passed, including 342 prediction-record checks
  and all focused football foundation, research, weekly-slate, and product tests

No deployment is authorized by this audit.
