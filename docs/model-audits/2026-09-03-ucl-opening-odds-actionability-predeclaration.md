# UCL historical opening-odds actionability predeclaration

Recorded after the fixed r4 forecast replay and before the first UCL historical
opening-odds request or any odds/outcome join.

## Frozen forecast cohort

- Model: `ucl_goals_coherent_2026_09_03_r4_singular_history_cohorts`.
- Training remains 185 usable regulation-final season-2024 matches.
- Calibration remains the first 126 usable season-2025 matches.
- Untouched holdout remains the final 63 usable season-2025 matches beginning
  `2026-01-28T20:00:00.000Z`.
- No match may move between blocks. Every forecast uses only matches strictly
  earlier than its kickoff. The evaluated sportsbook is excluded from the PMF.

## Odds source and canonical quote

- Source: Ball Don't Lie UCL v1 `GET /odds/opening` queried only by the already
  frozen match IDs, in batches of at most 40 IDs. No current odds are substituted.
- Fields: provider odds ID, match ID, named `vendor`, `moneyline_home_odds`,
  `moneyline_draw_odds`, `moneyline_away_odds`, `opened_at`, and `updated_at`.
- A row is eligible only when the vendor is nonblank and all three American
  prices are finite and valid. Exact duplicate provider IDs are collapsed.
- Multiple rows for the same match/vendor resolve to the earliest valid
  `opened_at`, then `updated_at`, then lowest provider odds ID. This rule is
  independent of outcome.
- The evaluated quote is the best available eligible opening price for the
  model's already-frozen Match Result side. Ties resolve by normalized vendor,
  then provider odds ID. This price-shopping step cannot change the forecast.
- The complete three-way row is converted to implied probabilities and divided
  by their sum to produce the no-vig market probabilities. Those probabilities
  and the selected exact quote are downstream EV/grade evidence only.

## Coverage gate

- Only Match Result is eligible for this evaluation. The endpoint does not
  provide historical Double Chance, Total, or BTTS quotes; those markets remain
  No Play regardless of the result.
- Calibration and holdout must each have eligible exact quotes for at least 80%
  of their frozen matches. The holdout must contain at least 40 quoted matches.
- Empty, malformed, unnamed, cross-match, or partial three-way rows are
  ineligible. Insufficient coverage ends the evaluation with zero actionables.

## Calibration-only threshold search

- One unit is risked at each exact opening price; pushes are impossible for
  three-way Match Result.
- Candidate model-probability floors are 0.40, 0.45, 0.50, 0.55, 0.60, and 0.65.
- Candidate EV floors are 0%, 2%, 4%, 6%, and 8%.
- A candidate requires at least 30 calibration plays, positive calibration
  units, positive calibration ROI, and realized hit rate above its aggregate
  exact-price break-even rate.
- Select the candidate with highest calibration units; ties resolve by higher
  ROI, then higher EV floor, then higher probability floor. Do not inspect the
  holdout during selection.

## One-shot holdout acceptance and grade mapping

- Evaluate the selected candidate once on the untouched holdout.
- Match Result may promote from No Play to Lean only if the holdout has at least
  20 plays, positive units, positive ROI, and realized hit rate above aggregate
  exact-price break-even. Otherwise all Match Result rows remain No Play.
- No Best Angle is authorized by this search. Double Chance, Total, and BTTS
  remain No Play. There are no quotas, contrarian selections, or side changes.
- Report calibration/holdout quote coverage, threshold, plays, W-L, units, ROI,
  hit rate, break-even, and the full before/after board counts. Report every
  promotion and demotion; the baseline is all-No-Play.
