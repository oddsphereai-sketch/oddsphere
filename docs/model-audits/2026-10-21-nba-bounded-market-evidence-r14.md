# NBA bounded market-evidence continuity r14

Date: 2026-10-21
Base: `c9098cdc3d98ee660a41a9869e4be09e0189af28`

## Problem

The unlocked NBA member pipeline still performed a direct `line_history` read
that silently stopped at the database's 1,000-row response ceiling. The
canonical split and price readers also used offset pagination against a mutable
row count, so concurrent ingestion could invalidate an otherwise healthy
slate. Finally, canonical evidence had a 03:45-11:00 UTC collection blackout
even while the separate NBA line writer remained healthy. The professional
reader correctly rejected that evidence once it exceeded its 120-minute
freshness boundary.

## Repair

- Market-marriage release:
  `nba_market_marriage_2026_10_21_r14_bounded_high_water_market_evidence`.
- The member pipeline derives opening/movement chronology from the same fully
  paginated canonical price observations used by the professional reader.
- Split and price reads use monotone ID keyset pagination bounded by a captured
  high-water ID. Appends during a read can no longer skip, duplicate, or abort
  the original evidence set.
- The existing public/canonical collector gains an hourly `20 4-10 * * *`
  continuity run. It remains the only collector and retains the same lease,
  freshness, target-exclusion, and source contracts.

The r11 forecast, r6 reader, r5 grade policy, selected sides, prices,
projections, grades, stakes, writer, lock semantics, and historical records do
not change. This repair restores the complete evidence that those existing
rules were already designed to evaluate.

## Verification

- The production-shaped evidence probe read 5,446 split observations and
  20,678 price observations for one game without the former 1,000-row ceiling.
- NBA same-book movement boundary tests passed.
- NBA professional site/writer/lock tests passed.
- Current-refresh cadence tests passed.
- TypeScript passed with no errors.
- Repository-wide `npm run verify:model-change` passed.

Rollback is the r11 market-marriage reader and prior cron schedule. Locked rows
retain exact stored precedence under either reader.
