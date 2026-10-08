# NFL player props 2026 current-season replay predeclaration

## Decision and scope

This audit answers a narrower question than the historical tournament: what do the forecasts that
Oddsphere actually locked during the first four completed weeks of the 2026 NFL season say about
the independent model, the market read, and the published marriage?

The replay is SELECT-only. It must not rewrite a locked record, settle a pending record, change a
grade, or alter a production release. The immutable `nfl_player_prop_records.snapshot_json.decision`
payload is authoritative for every locked forecast. Outcomes come from the stored 2026
current-season state, with the stored ledger result used only as a cross-check. No provider call is
allowed.

The current-season state contains 64 final games through Week 4. The locked ledger does not claim
full-board coverage: it contains only actionable records written after tracking became available.
The audit will report the exact number of covered games, records, canonical forecast scopes, and
outcome matches. A separate Week 4 full-board replay may be cited as supporting evidence, but it
must not be blended into the four-week ledger metrics.

## Frozen comparisons

For every outcome-matched, non-push locked decision, compare:

1. `rawModelProbability`: the independent model probability for the locked side;
2. `marketProbability`: the market-implied probability stored at lock;
3. `finalProbability`: the published model/market probability stored at lock.

Primary probability endpoints are Brier score and log loss. Secondary endpoints are side accuracy,
mean forecast probability, observed win rate, and calibration gap. Results must be reported both
for exact locked records and for canonical scopes deduplicated by game, player, market, line, and
side. Canonical metrics are the model-accuracy view; exact-record metrics are the product-record
view.

For records with a stored independent point projection, compare independent projection, published
projection, and the offered line using MAE and RMSE against the actual result. Also report whether
the independent and published point forecasts selected the correct side of the locked line. Lines
are a decision boundary rather than a literal mean forecast, so line MAE is a descriptive market
benchmark, not a like-for-like model estimate.

All metrics must be split by week, market, and decision release before any archive aggregate is
described. No mixed-release aggregate may be called current-model performance.

## Movement analysis

Use only movement stored in the locked payload. Measure same-book opening-to-lock line and price
movement when both values exist, and report the stored `marketMovement` cohorts. Because the
historical evidence does not contain Pinnacle and does not identify a complete sharp-book feed,
the audit must call these market-movement cohorts, not sharp action.

## Uncertainty and candidate diagnostics

Confidence intervals use deterministic game-cluster bootstrap resampling, so duplicated books and
multiple props in one game are not treated as independent evidence. Report 95% intervals for the
independent-minus-final and independent-minus-market Brier differences, plus the
independent-minus-published point-MAE difference.

A predeclared residual-weight grid of `0, 0.20, 0.35, 0.50, 0.65, 0.80, 1.00` may be shown as a
diagnostic, where zero is market-only and one is independent-only on the log-odds residual path.
It is not a promotion test: choosing a weight and evaluating it on these same four weeks is
in-sample. No live weight, grade, stake, or selection change is authorized by this replay.

## Interpretation gates

- Independent probability is directionally supported only if its canonical Brier score is lower
  than both market and published final probability and the game-cluster interval excludes zero for
  both differences.
- A point-model change is directionally supported only when independent point MAE improves on the
  published projection in the archive aggregate and does not worsen in more than one completed
  week. It remains shadow-only without a later untouched confirmation window.
- Sparse market/week cells are reported but cannot authorize production behavior.
- Pending ledger rows remain unchanged even when a research outcome can be matched.
- Missing full-board snapshots for Weeks 1-3 are a data-retention limitation, not zero prop volume
  and not evidence that the model did or did not perform on unarchived offers.
