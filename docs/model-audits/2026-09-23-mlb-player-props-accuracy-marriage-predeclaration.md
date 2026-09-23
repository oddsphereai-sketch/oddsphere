# MLB Player Props accuracy-marriage predeclaration

Date: 2026-09-23

## Scope and production boundary

- Base commit: `a1e1b0f6abc69de7f38b84c6832f32533c220d41`.
- Sport and markets: every currently supported MLB player-prop market, with candidate behavior
  limited to market-side probability calibration and actionability policy.
- Active complete release: `mlb_props_2026_09_21_r43`.
- Active market context release:
  `mlb_props_market_aware_context_2026_09_02_r2_target_excluded_forecast`.
- The sole writer remains `/api/cron/mlb-player-props-refresh` through `refreshMlbPropsBoard` under
  the existing `prediction_pipeline:mlb` lease. No route, cron, provider request, UI label, member
  copy, layout, stake, lock, settlement, or historical-record rewrite is authorized.

## Known evidence before candidate selection

The r43 actionable ledger was inspected before this declaration. It has 141 settled decisions at
91-50: 126 Unders at 87-39 and 15 Overs at 4-11. The Under concentration is currently accretive to
prediction accuracy; a side-balancing quota would make the product worse. Weak Over performance is
concentrated in the small Home Run, pitcher-strikeout, and pitcher-outs cohorts, while Lean Unders
carry the current release. These observations are no longer blind and are a problem statement,
not an authorization to delete Over markets or tune on r43 outcomes.

The existing r40-r43 target-excluded forecast, projection coherence, exact-price, and price-confidence
boundaries remain authoritative unless a candidate passes the chronology below. Home Run milestone
accuracy must be evaluated with Brier/log loss and locked-price economics; raw hit rate is not
comparable to an ordinary -110 two-way prop.

## Candidate families and chronology

Candidate evaluation is restricted to:

1. Per-market/side reliability calibration of the existing independent-plus-target-excluded
   posterior, without using the evaluated sportsbook as a forecast input.
2. Bounded use of existing same-book opening/current movement, coherent related-market movement,
   and exact row-scoped split evidence when genuinely present. Missing split evidence stays neutral.
3. Paired grade changes: a weak actionable lane may demote only with a tested promotion from an
   existing eligible Watchlist pool that preserves price, lineup, freshness, research, projection,
   and target-excluded-comparator gates.

Chronology is frozen before candidate search:

- historical observations retain their existing prior-only folds;
- r42 rows through 2026-09-11 are train/diagnostic;
- r42 rows from 2026-09-12 through 2026-09-16 are selection;
- r42 rows from 2026-09-17 through 2026-09-20 are untouched confirmation;
- r43 rows beginning 2026-09-21 are forward monitoring only and cannot choose thresholds.

Release eras will be reported separately even where r43 left r42 prediction/action math unchanged.
Multiple props from the same player/game are clustered. A candidate must improve Brier/log loss or
side accuracy on confirmation, retain positive locked-price value, and avoid a category collapse.

## Required board and safety evidence

The paired current-board replay must report exact promotions, demotions, retained actionables, net
actionables, market/side mix, grades, prices, nonpositive-EV actions, projection/side contradictions,
and all changed rows. The existing writer, provider budgets, snapshot publication, member reader,
T-60 locks, settlement, and last-known-good behavior must remain unchanged. Insufficient evidence
keeps the candidate shadow-only.

