# CFB market-history continuity capacity

Date: 2026-10-20
Scope: CFB sole-writer compact movement-history read only

## Production incident

The current CFB compact member snapshot remained on its 06:00 ET publication
while every five-minute `cfb_forward_evidence` run failed with:

`CFB forward market history exceeded its bounded 20000-row visible-board limit.`

A read-only production count found 21,054 evidence rows inside the required
72-hour window: 20,869 unlocked observations, 96 immutable openings, and 89
T-60 rows. The reader failed before schedule, odds, split, injury, weather,
forecast, prediction, or snapshot work could begin.

## Repair

The compact market-history ceiling increases from 20,000 to 50,000 rows. This
matches the existing bounded season-reader ceiling and covers the documented
96-game board at a 15-minute cadence for 72 hours (27,648 observations), plus
opening/T-60 lifecycle rows and bounded release-transition headroom.

The reader still:

- projects only compact market, opening, split, and request-budget fields;
- pages in stable `captured_at`, then `id`, order;
- includes immutable openings plus only the latest 72-hour movement horizon;
- accepts only the declared compatible releases; and
- fails closed rather than truncating if the new explicit bound is reached.

## Same-input board impact

- Forecast sides changed: 0
- Probabilities changed: 0
- Projected scores changed: 0
- Grade promotions/demotions: 0 / 0
- Stakes changed: 0
- Provider calls changed: 0
- Existing locked records changed: 0
- Writer topology and lease changed: 0

The only intended behavior change is that a valid continuity window between
20,001 and 50,000 compact rows no longer prevents the existing leased writer
from refreshing current evidence and republishing the member snapshot.

## Release and rollback

Sole writer:
`cfb_forward_evidence_writer_2026_10_20_r130_market_history_continuity_capacity`.

Roll back to r129 if the larger bounded read times out, exceeds memory limits,
changes a same-input forecast/decision tuple, bypasses the saturation guard,
creates a second writer, bypasses `prediction_pipeline:cfb`, or mutates a
stored locked record.
