# WNBA exact-price denominator handoff — 2026-09-19

## Scope and pre-change evidence

This change is limited to the WNBA prediction-record and member-reader economic-evidence handoff.
The current production champion remains model `wnba_v1_4_single_market_entry`, distribution
`wnba_single_market_entry_2026_09_03_v6`, calibration
`wnba_core_calibration_v4_single_market_entry`, grade policy
`wnba_grade_policy_v9_single_market_entry_2026_09_03`, and decision tuple
`wnba_decision_tuple_v4_single_market_entry_2026_09_03`. The sole scheduled owner remains
`/api/cron/wnba-daily-refresh` under the WNBA `prediction_pipeline` lease.

The September 19 production slate contained three games and nine complete forecast records. SEA
at GS had five complete named-book pairs, but every target-excluded alternative belonged to one
conservatively shared, unverified provider lineage. The model correctly left the stricter
target-excluded fair probability null. Its exact evaluated quotes and pre-existing value gates
were complete: GS -12.5 at -115 had model probability 63.8467%, break-even probability 53.4884%,
probability edge 10.3583pp, and expected return 19.3655%; Over 155.5 at -112 and GS moneyline at
-900 had the same complete exact-price evidence shape. The tracking/reader handoff nevertheless
dropped the break-even denominator and edge.

## Release behavior and board impact

Record contract `wnba_prediction_record_contract_v8_exact_price_denominator_2026_09_19` keeps a
qualified market fair probability when available. Otherwise, and only with a complete nonzero
exact evaluated price, it stores that price's deterministic break-even probability as the
economic denominator and records the source in `prediction_record_economic_denominator`.
The original target-excluded fair probability remains null in the decision tuple and provenance.

On the same three-game/nine-market input wave the candidate changes zero forecasts, selected
sides, model probabilities, projections, grades, stakes, holds, prices, sportsbooks, or lines. It
has zero promotions and zero demotions, and the freshly captured actionable board remains one Best
Angle and zero Leans. The earlier stale wave's SEA-GS spread would become complete at 53.4884%
market implied and +10.4pp displayed edge without changing its then-current Best Angle grade.
There is no provider call, schema, schedule, cron, pagination, writer, or lease change.

## Verification and rollback

Focused WNBA tests must prove qualified fair-probability precedence, exact-price fallback math,
unchanged grades, and the immutable r8 identifier. The complete model-change suite, TypeScript,
lint, production build, latest-main integration safety, protected pull-request checks, exact live
release stamp, successful leased writer cycle, current board counts, and site responsiveness are
required before declaring the repair live.

Rollback the record/reader contract together to v7 if any selected side, forecast probability,
grade, stake, exact quote, or actionable count changes; if a null/zero price produces a denominator;
if the target-excluded null is overwritten; if releases mix within the current unlocked slate; or
if writer latency, provider load, lease behavior, or reader stability regresses. Locked historical
records remain immutable under either release.
