# NHL runtime parity and two-sided price history r7 — 2026-09-29

## Scope and decision

Activate `nhl_regular_2026_r7_runtime_parity` with calibration and decision
releases of the same r7 family. The authoritative writer, sport-scoped
`prediction_pipeline:nhl` lease, lock behavior, thresholds, stakes, schedule,
provider-call ceiling, and member copy remain unchanged. Reader release
`nhl_daily_edge_reader_2026_09_29_r3_two_sided_price_history` exposes the
already-stored same-book price trails for both outcomes. Refresh release
`nhl_daily_refresh_schedule_2026_09_29_r5_canonical_two_sided_quotes` admits
only active pregame, complete two-sided quotes.

## Score-model defect and repair

The released opponent-adjusted score fit was trained on MoneyPuck special-
teams expected goals per game. Production supplied the same coefficients with
special-teams expected goals per 60 minutes of power-play or penalty-kill ice
time. Values near 7–10 entered slots trained around 0.52, and the negative
coefficients pulled every live Total toward five goals. This was a runtime unit
mismatch, not a finding that the historical model itself should be made more
market-dependent.

r7 computes power-play xG for and penalty-kill xG against per game for the
score fit while retaining per-60 values for evidence display. All other r6
model equations and the r5 Moneyline/puck-line foundation remain unchanged.
The focused regression proves that large per-60 display values cannot replace
the per-game model inputs.

On the full 1,312-game 2025 replay, the correctly shaped r6/r7 predicted game
Total has mean 5.9521, standard deviation 0.2455, range 5.2416–6.6699 and 16
distinct tenths. Predicted team scores range 1.9678–4.1234; predicted margin
standard deviation is 0.5482 with range -1.6434–2.0918. On the untouched final
30% (394 games), predicted Totals range 5.3124–6.6699 and team scores range
1.9678–4.1234. The previously recorded untouched accuracy remains team-score
MAE 1.389944, Total MAE 1.849124 and Total direction 58.61%. This evidence does
not guarantee a future hit rate.

## Current-slate board impact

The same five games and all 15 markets remain present with zero errors and no
missing selected-side prices. Corrected projected Totals are 6.13–6.46 instead
of the defective r6 live range near 5.0–5.25; team means span 2.53–3.60 and
absolute expected margins span 0.14–1.06.

The board moves from 5 Best Angles / 9 Leans / 1 Watchlist (14 actionable) to
0 Best Angles / 10 Leans / 5 Watchlists (10 actionable). There are zero
promotions and six demotions: all five r6 Total Best Angles lose inflated
confidence, with BOS-NYR also changing from Under to Over, and CHI +1.5 moves
from Lean to Watchlist. Every market family remains actionable: 4 Moneylines,
2 Totals and 4 puck lines. No quota or suppressive threshold is added.

Creating compensating promotions would knowingly preserve confidence produced
by the unit defect, so the owner-approved correctness exception records the
unpaired board change explicitly. Rollback is r6, but only as an operational
fallback; its live score tuple must not be represented as correctly scaled.

## Price board and failure behavior

The production tables already held home/away, over/under, and complementary
puck-line prices plus append-only history. The reader exposed only the picked
side and opener. r3 now sends current/open/move stops for the picked side and
the opposite outcome from one complete named-book pair through the existing
price-trail UI contract. It adds no copy or labels.

The refresh discards inactive, live, stale-pregame and alternate provider rows,
collapses duplicate observations deterministically, and accepts a book/market
group only when both complementary outcomes are present. A partial response
does not replace the last complete database group. The same canonical two-
sided rows feed internal no-vig probability, same-book movement, exact-price
selection, writer snapshots and the member reader.

## Verification and rollback gates

Required before publication: focused NHL tests, TypeScript, lint, full
`verify:model-change`, production build, clean latest-main integration proof,
protected PR checks, mobile 390-pixel reader verification, and a read-only
five-game/15-market replay. After deployment the sole cron must write 15 r7
rows under one lease; the reader must match the writer's score tuples, retain
all games and markets, show complete two-sided price trails, and preserve prior
locks. Hold or roll back on mixed releases, incomplete coverage, a score/side
contradiction, one-sided actionable pricing, writer overlap, reader failure, or
mobile navigation overlap.
