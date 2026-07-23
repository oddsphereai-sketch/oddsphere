# MLB props home-run qualification release — 2026-07-23

## Scope

- Sport/market: MLB batter home runs.
- Previous release: `mlb_props_2026_07_22_r2`.
- Current release: `mlb_props_2026_07_23_r3`.
- Market model: `batter_home_runs_rare_event_integrated_read_v3_all_qualified_actionable`.
- Projection, probability, price, confidence, provider, refresh, lease, snapshot,
  publication, and tracking infrastructure: unchanged.

## Decision change

Every best available home-run Over offer becomes a Lean when it passes all of
the existing qualification gates:

- final probability from 15% through 18%, inclusive;
- positive expected value;
- confidence of at least 62%;
- signal-eligible American price;
- best offer for the same game/player/market/side/line.

The former five-per-slate promotion limit is removed. Qualified home-run Leans
are also exempt from the generic hitter per-player/per-game concentration
demotions because those demotions would recreate an arbitrary cap after the
market-specific qualification rule had already passed. Duplicate inferior
prices are still downgraded.

Non-qualifying home-run rows remain Watchlist.

## Locked replay evidence

Using the current qualification rule on locked July 16–22 tracking rows:

- all 65 qualifying offers: 13–52, +36.60 flat units, +56.3% flat ROI;
- former daily top-five subset: 5–26, +6.85 units, +22.1% ROI;
- 34 qualifiers formerly hidden by the cap: 8–26, +29.75 units, +87.5% ROI;
- 242 non-qualifying Watchlists: 35–207, -13.09 units, -5.4% ROI.

At the intended 0.25-unit stake, the qualifying group returned +9.15 units
while risking 16.25 units. The sample is only seven slates and remains subject
to rare-event variance; it supports removing the arbitrary display-grade cap,
not increasing the 0.25-unit stake.

## Load and rollback

This change removes an in-memory array slice and bypasses generic hitter caps
for already-qualified HR Leans. It adds no provider call, database query,
writer, cron, retry, refresh, or concurrent workload.

Rollback target: `mlb_props_2026_07_22_r2`.
