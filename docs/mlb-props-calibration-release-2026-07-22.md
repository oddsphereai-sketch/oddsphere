# MLB props calibration release — 2026-07-22

## Scope

- Sport: MLB player props only.
- Authoritative runtime: the existing `refreshMlbPropsBoard` / real scorer path.
- Writers, leases, schedules, provider calls, pagination, and snapshot limits: unchanged.
- Previous bundle release: `mlb_props_2026_07_20_r1`.
- Candidate bundle release: `mlb_props_2026_07_22_r2`.
- Locked data used: July 16–21, 2026. Voids, pushes, and pending rows are excluded from
  probability scoring.

The July 16–19 rows are the calibration period. July 20–21 is the untouched chronological
holdout. Per-market attribution began July 20; Git history confirms the pitcher strikeout
model code itself predates that stamp, so the two eras are behaviorally comparable for the
reliability-layer evaluation.

## Predictive findings

Lower Brier score is better. `Existing holdout` is the probability shown by the current
release. `Candidate holdout` applies only weights selected from the calibration period.

| Market | Calibration rows | Holdout rows | Brier old → new | Log loss old → new | Mean probability old → new → actual |
| --- | ---: | ---: | ---: | ---: | ---: |
| Batter total bases | 592 | 373 | 0.2494 → 0.2440 | 0.6926 → 0.6812 | 60.3% → 54.5% → 55.2% |
| Batter RBIs | 598 | 387 | 0.2155 → 0.2144 | 0.6216 → 0.6193 | 66.3% → 65.3% → 64.1% |
| Batter runs scored | 601 | 392 | 0.2449 → 0.2431 | 0.6835 → 0.6794 | 63.0% → 60.4% → 56.4% |
| Batter doubles | 190 | 110 | 0.1258 → 0.1248 | 0.4224 → 0.4203 | 79.8% → 78.6% → 86.4% |
| Pitcher strikeouts | 74 | 47 | 0.2934 → 0.2663 | 0.7899 → 0.7262 | 57.3% → 53.1% → 40.4% |
| Pitcher walks | 67 | 44 | 0.2659 → 0.2377 | 0.7291 → 0.6680 | 58.6% → 54.1% → 50.0% |

The dedicated July 20 batter-hits, HRR, batter-walks, and pitcher-earned-runs models are
preserved. Singles and pitcher-outs action rules are also preserved because their actionable
subsets were profitable even though their full-population calibration was imperfect.

## Promotion/demotion balance

The locked July 20–21 candidate replay contains 284 existing Best Angle/Lean decisions.

- Reliability gates would demote 100: 91 total-bases decisions and 9 pitcher-strikeout
  decisions.
- Strict Runs Scored promotion candidates: 137 in calibration, 86–51, +4.72 units (+3.4%
  flat one-unit ROI); 61 in holdout, 44–17, +10.75 units (+17.6%).
- Strict pitcher-earned-runs promotion candidates: 44 in calibration, 27–17, +6.16 units
  (+14.0%); 23 in holdout, 17–6, +8.65 units (+37.6%).
- Bounded HR promotion: at most five per slate, final probability 15–18%, positive EV, best
  price only. The six-day replay was 5–21 for +11.85 units (+45.6%), with at least one winner
  on five of six slates; the July 20–21 holdout was 2–8 for +2.75 units (+27.5%).

Gross candidate impact before the existing player/game correlation caps is 100 demotions and
up to 94 promotions across the two holdout slates. Existing price, freshness, lineup,
data-quality, best-price, per-player, and per-game gates remain mandatory and may reduce the
published promotion count.

The strikeout calibration remains conservative rather than claiming the two-day 40.4% result
is the true long-run rate: its weight was selected on July 16–19, and the unchanged candidate
then reduced both Brier score and log loss on July 20–21.

## Calibration rules

The candidate final probability is:

`model_weight × independent_model_probability + (1 − model_weight) × no_vig_market_probability`

The model weight is capped only for market/direction pairs that improved in the chronological
replay. A zero cap means the model may still be displayed and tracked diagnostically, but it
cannot manufacture an actionable edge for that direction. Missing two-way market prices
continue to fail closed; they are never replaced with a synthetic actionable probability.

## Load and rollback

The change adds no network call, database query, writer, cron, retry, or refresh. It is pure
in-process arithmetic over data already present in each scored row. Snapshot publication
remains atomic and retains the prior coherent snapshot on failure.

Rollback target: `mlb_props_2026_07_20_r1`. Roll back if the live slate contains mixed release
IDs, provider prices are missing, the post-cap board is unexpectedly empty, refresh overlap or
latency increases, or the reader probability differs from the stamped snapshot.
