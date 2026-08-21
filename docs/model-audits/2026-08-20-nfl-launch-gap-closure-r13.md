# NFL Daily Edge launch-gap closure r13

Date: 2026-08-20  
Scope: local/shadow NFL Daily Edge only  
Production deployment or database writes: none

## Outcome

The real 2026 Preseason Week 2 slate remains the active member-shaped local board. It contains 16 verified games and 48 predictions, opens in the existing signed-in Daily Edge reader, and is permanently excluded from public tracking and the NFL lifetime record. The separately stored 2026 Regular Week 1 board now has checksum-backed current prices, operational Openings, Playbook consensus lines, public money/ticket splits, an immutable exact-price decision policy, and a tested lock/settlement proposal lifecycle.

This closes the local data, reader, grade-policy, lock-shape, settlement, and tracking-boundary implementation gaps. It does not claim a proven betting edge and does not approve production launch.

## Releases

- Market evidence: `nfl_regular_market_evidence_2026_08_20_r2`
- Runtime: `nfl_market_reference_player_value_runtime_2026_08_20_r3`
- Scored snapshot: `nfl_daily_edge_local_snapshot_2026_08_20_r3`
- Member snapshot: `nfl_daily_edge_local_member_snapshot_2026_08_20_r3`
- Decision: `nfl_regular_price_value_decision_shadow_2026_08_20_r2`
- Tracking lifecycle: `nfl_tracking_lifecycle_shadow_2026_08_20_r2`
- Accepted player-value calibration remains `nfl_market_logit_player_value_adjustment_2026_08_20_r2`

## Immutable evidence

- Regular Week 1 evidence file: `nfl_regular_2026_week_1.market-evidence.d04616719d365624.json`
- Evidence SHA-256: `d04616719d365624c1921b75ed06fa96b0bbdfe58c89c0ace88f631fbea0d979`
- Captured: `2026-08-20T22:31:32.538Z`
- Coverage: 16/16 complete named-book price pairs, 16/16 operational Openings, at least two stored same-book observations per game, 16/16 Playbook consensus-line sets, and 16/16 complete money/ticket split sets.
- BALLDONTLIE returned zero provider-native opening rows. The earliest verified stored same-book observation is therefore the operational `Opening`; its source and timestamp remain preserved.
- Provider cost: four BALLDONTLIE requests plus two Playbook requests for the entire weekly capture. Member reads make zero provider calls.
- Active preseason member file: `nfl_daily_edge_2026_preseason_week_2_f5a8521efdad14ae.json`
- Active preseason SHA-256: `f5a8521efdad14aed00325ca248246694018f7a97ce674676feb0b08a8d933e4`
- Stored regular member file: `nfl_daily_edge_2026_regular_week_1_61c300097c278a32.json`
- Stored regular SHA-256: `61c300097c278a326b9011292ebcdf40ddd50148cdccac4de7a54c0066f7b4c9`

## Decision policy

The regular decision policy uses the displayed selected-side probability, exact displayed American price, same-book observation count, availability freshness, and price freshness. Public consensus splits are context only: they cannot change probability, create a play, or promote a grade until a chronological split-history tournament qualifies them.

Action promotion requires complete finite probabilities/prices, a current availability snapshot, a price no older than six hours, at least three same-book observations, and positive exact-price EV above the frozen Lean or Best Angle threshold. An actionable total additionally requires a current game-time weather snapshot. Weather is a promotion gate only; its absence does not invent, reverse, or hide the underlying total forecast and may leave a supported row at Watchlist.

## Board-count impact

The current Preseason Week 2 board remains five local dry-run Leans, nine Watchlists, and 34 No Plays across 48 predictions. These are rehearsal outputs only; all 48 are ineligible for official tracking even when approval, registry, and lock flags are deliberately set true in tests.

The Regular Week 1 shadow board is three Watchlists and 45 No Plays, with zero Leans and zero Best Angles. Relative to the prior all-No-Play board, this is three No Play-to-Watchlist promotions, zero actionable promotions, and zero actionable demotions. The three Watchlists are:

- ATL at PIT Over -115: -2.0% exact-price EV
- CLE at JAX Over -118: -1.9% exact-price EV
- BUF at HOU Over -112: -2.3% exact-price EV

None qualifies as an actionable play. Thresholds were not relaxed to manufacture action.

## Tracking boundary and settlement

- The active product phase is Preseason Week 2.
- Preseason is permanently excluded from official results and existing lifetime totals.
- The public NFL start boundary is future-dated to `2026-09-10`.
- At an approved regular-season launch, moneyline, total, and spread are the official markets.
- Every scheduled game must have its own actual pre-kickoff lock timestamp.
- Moneyline and total append to the existing NFL lifetime baseline; spread begins forward-only.
- Weekly row counts are `scheduled games × 3`, so bye weeks no longer fail a hard-coded 16-game/48-row assumption.
- Win, loss, push, void, and postponed/canceled settlement paths are covered by focused tests.

The tracking lifecycle currently produces immutable proposals and settlement outcomes in local shadow code. It is not connected to a production prediction writer or cron, so it cannot mutate the database.

## Remaining launch evidence

The unresolved blocker is evidence, not missing UI: moneyline and spread are still the accepted market reference because independent side challengers failed the historical market gate, and the accepted player-value total correction is small. The current regular board consequently has no positive-EV actionable row. Production launch still requires an approved release, real game-specific lock captures, a shared-lease production writer/cron, and forward locked-price/CLV evidence. Those cannot be truthfully manufactured before the market and games produce them.

## Verification

- `npm run test:football-product-preview`
- `npm run test:football-tracking-lifecycle`
- `npm run test:football-daily-edge-member`
- `npm run test:official-tracking-markets`
- `npm run test:tracking-scope-invariant`
- `npx tsc --noEmit --pretty false`
- `npm run verify:model-change` (required before handoff)
- In-app browser: `/lab/daily-edge?sport=nfl` showed `NFL · Preseason Week 2 · 16 games · 48 predictions · preseason is excluded from official tracking`, and opening LV at HOU exposed the standard Quick Read, Market & Price, and Key Stats & Notes reader sections.

## Rollback

No production rollback is required because no production write or deployment occurred. The local rollback is to the r12 member snapshot/release pointers plus the prior empty NFL official-tracking registry; doing so would remove the completed preseason/regular lifecycle protections described above.
