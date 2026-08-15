# Six-market completion — WNBA v1.3

## Decision

Release the WNBA Total reflected-projection champion. Retain the WNBA
Moneyline and Spread upstream heads and all previously released v1.2 action
policies. Retain MLB r48 in full, including the existing First Inning head.

This completes the fresh tournament with a concrete answer for every market;
it does not manufacture a change where no safe challenger qualified.

## WNBA Total champion

The incumbent raw total projection is reflected around the locked market line:

```text
champion_projected_total = 2 * market_total - raw_projected_total
```

The incumbent-side probability is
`sigmoid(-0.30122681 + 0.03801060 * abs(raw_projection_edge))`. When that
probability is below 50%, the coherent opposite side is selected and receives
`1 - p`. Production requires an exact current price for that side; otherwise
the existing total remains unchanged.

On the chronological raw-side tournament, validation moved from 8-12 (40%)
to 12-8 (60%) and latest from 9-11 (45%) to 12-8 (60%). Combined accuracy
improved 17.5 percentage points. Three of four rolling-origin accuracy folds
improved. Validation Brier/log loss moved 0.2497/0.6921 to 0.2528/0.6988;
latest improved 0.2580/0.7090 to 0.2441/0.6813. The validation proper-score
regression remains inside the predeclared safety allowance and is disclosed.

Projection error was checked directly against settled game totals. Validation
RMSE improved 16.8978 to 16.1237 while MAE moved 13.7800 to 14.3200. Latest
RMSE improved 11.8714 to 11.2214 and MAE improved 9.3050 to 9.0950. Reflected
RMSE improved in three of four rolling windows; MAE improved in three of four.

Historical WNBA records do not contain exact opposite-side prices, so no
downstream action policy can be honestly promoted from this cohort. Every
changed Total is Watchlist/`no_bet`. The new paired-market snapshot contract
supplies exact current prices at runtime but does not rewrite history.

## Retained challengers

- WNBA Moneyline: no upstream challenger qualified. The v1.2 exact-price
  positive-EV action addition remains active.
- WNBA Spread: the side-changing price stack improved latest accuracy, but
  historical opposite-side price coverage is zero. Its apparent action result
  cannot authorize a new side. The v1.2 calibrated probability and exact-price
  action replacement remain active.
- MLB First Inning: locked no-vig market consensus improved combined raw
  accuracy by 3.8 points, but it changed 66 sides and no downstream action
  replacement qualified. Shipping it would displace established FI actions
  without a balanced promotion pool, so r48 FI remains authoritative.

## Runtime and release

- Model: `wnba_v1_3_total_projection_champion`
- Distribution: `wnba_market_heads_value_calibrated_2026_08_15_v5`
- Calibration schema: `wnba_core_calibration_v3`
- Grade policy: `wnba_grade_policy_v8_total_projection_champion_2026_08_15`
- Total rule: `wnba_total_market_reflected_projection_v1_2026_08_15`

The authoritative writer remains `runWnbaModel.ts`, with tracking through
`buildWnbaPredictionRecords.ts` under the WNBA-scoped shared
`prediction_pipeline` lease. No writer, cron, provider call, stake path, or
historical rewrite is added.

## Current-slate dry run

The read-only August 15 model run found six scheduled games, five with complete
odds, five predicted, zero missing markets, and zero errors. All five totals
were Watchlists; no new Total action was created.

## Rollback

Restore WNBA model v1.2, distribution v4, calibration schema v2, and grade
policy v7. MLB rollback remains r47 as documented by r48. Locked historical
rows retain their original release identifiers.
