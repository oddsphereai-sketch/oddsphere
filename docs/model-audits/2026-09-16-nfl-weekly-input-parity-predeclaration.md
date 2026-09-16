# NFL weekly input parity predeclaration

Date: 2026-09-16
Starting production base: `d70d73841116cdd8bece38a4e1ccaa40e1c524f7`

## Incident and frozen evidence

The live Week 2 slate is complete at 16 games / 48 predictions, but its forecast
surface is materially flatter than the Week 1 release. A release-pure database
comparison found two independent input differences:

- Week 1 has a game-specific calibrated Spread/Total core on 16/16 games; the
  later-week runtime has that core on 0/16 games and instead uses the validated
  market-anchored weekly fallback.
- Week 1 stored usable SharpAPI split evidence on 15/16 games; Week 2 currently
  has 0/16. The NFL collector requests `sport=nfl`, while the provider's current
  contract exposes NFL as `league=nfl` and uses `sport=football`. Read-only live
  probes returned zero rows for the incumbent request. The provider also returns
  zero current NFL split rows for the corrected league request at this capture,
  while its event-specific history contains older Week 2 DraftKings/Circa rows.

The first defect cannot be repaired by copying Week 1 corrections, lowering
grade thresholds, changing market weight, extending split freshness, or forcing
plays. The game-specific artifact is not a deployable weekly calibrator, and the
previously evaluated independent later-week challenger failed the protected 2025
market benchmark. That model path therefore remains unchanged unless a qualified
walk-forward artifact is produced.

## Frozen production repair

Repair only the confirmed SharpAPI request-contract mismatch in the existing
sole NFL writer. Query `/splits` with `league=nfl`, retain one bounded 200-row
request, strict NFL/date/team identity, deterministic Circa/DraftKings/BetMGM
priority, complete complementary percentages, and the existing two-hour
forecast freshness boundary. Do not use provider history as a forecast input,
because its current rows are older than the authorized freshness window. Do not
change UI copy, grade thresholds, stakes, market weight, or tracking semantics.

Because the repair can restore a model input when the provider publishes a
current NFL row, version the input adapter and the complete affected NFL
model/calibration/decision/grade/member/writer/snapshot release family together.
The authoritative `prediction_pipeline:nfl` lease and writer remain unchanged.

## Acceptance gates

- A contract test proves the collector sends `league=nfl`, not `sport=nfl`, in
  exactly one bounded request.
- Existing identity, date, sportsbook priority, completeness, and malformed-row
  tests remain green.
- A release-pure current replay reports the honest before/after board count.
  Zero provider rows must produce zero promotions and zero demotions; it must not
  be presented as a flatter-board repair by itself.
- Week 1 versus Week 2 calibrated-core coverage and provider coverage remain
  recorded explicitly. No unqualified weekly calibrator is promoted.
- `npm run verify:model-change`, focused NFL tests, TypeScript, lint, production
  build, current-main ancestry, overlap safety, protected PR checks, deployment,
  and live release verification pass before success is declared.

Rollback the complete release family if request count grows, stale/wrong-game
split data enters a forecast, any no-row prediction changes, the weekly slate is
incomplete, or writer/lease health regresses.
