# MLB Player Props incremental value portfolios — r34

## Release decision

- Release: `mlb_props_2026_08_13_r34`
- Home Runs actionability: `actionability_v4_three_play_plus_medium_price_complement`
- Batter RBIs actionability: `batter_rbi_context_opportunity_integrated_read_v3_value_portfolio`
- Grade/stake: Lean, 0.10u
- Writer: unchanged `/api/cron/mlb-player-props-refresh` under the shared
  `prediction_pipeline:mlb` lease
- Demotions: zero

R34 does not loosen the r33 three-play Home Run selector. It adds a disjoint
second sleeve and one separate RBI ranking sleeve after member-board main-line
and best-price compaction. Existing stale-price, invalid-price, missing-context,
lineup, publication, and release-regression safeguards retain priority.

## Home Run complement

The complement uses the same prior-only HR-per-PA probability as r33 but first
removes all three core selections and their games. It then considers +351
through +650 offers with at least 10% model probability, two percentage points
of model edge, and 5% expected value, ranks by model probability, and releases
up to two additional hitters from unselected games.

The policy family was selected only after it was profitable in both halves of
the July 24-31 validation window. August 1-12 was then opened once for final
evaluation.

| Window | Record | Units | ROI |
|---|---:|---:|---:|
| Tune (Jul 24-27) | 3-4 | +9.47 | +135.3% |
| Confirm (Jul 28-31) | 2-3 | +5.11 | +102.2% |
| Untouched holdout (Aug 1-12) | 5-19 | +2.93 | +12.2% |

The combined holdout date-block bootstrap estimated P(profitable)=0.6188. Rank
one was 4-8 for +9.16u; rank two was 1-11 for -6.23u. The preselected two-play
basket nevertheless remained profitable on the untouched holdout, so r34
keeps it as a low-stake diversified Lean sleeve. A third complement failed
confirmation and holdout and is explicitly excluded. R34 therefore supports
up to five Home Run Leans, never a five-play quota.

## Batter RBI value ranker

The RBI sleeve keeps the existing side and probability. It considers only
Watchlists with a real best price from -200 through +300, nonnegative
model-versus-market edge, and nonnegative EV, then releases at most the
highest-EV candidate.

| Window | Record | Units | ROI |
|---|---:|---:|---:|
| Validation (Jul 24-31) | 6-2 | +8.89 | +111.1% |
| Untouched holdout (Aug 1-12) | 5-7 | +5.65 | +47.1% |

The holdout date-block bootstrap estimated P(profitable)=0.8052. Incremental
rank two went 1-7 and lost 5.15u in validation; rank three was negative in both
windows. Neither is live.

## Rejected Pitcher Hits Allowed candidate

The research ranker was positive in validation (8-7, +10.4%) and holdout
(14-10, +17.0%). The current-slate full-pipeline rebuild, however, marked both
would-be promotions `LOW_DATA_CONFIDENCE`. Shipping that sleeve would bypass an
existing data-quality gate and violate the model-change safety contract. It is
therefore not part of r34 and remains non-actionable.

## Paired board impact

The August 13 no-write full rebuild was publishable with zero errors. Relative
to r33, r34 adds two Home Run Leans and one Batter RBI Lean and demotes nothing.
All other market decisions remain owned by their existing releases. The exact
current qualifiers depend on the fresh best-price snapshot and can change on
the normal refresh cadence.

The reproducible read-only audit is
`scripts/operator/audit-mlb-props-all-market-feature-tournament.ts`, with the
local report at `/private/tmp/oddsphere-all-market-feature-tournament.json`.
