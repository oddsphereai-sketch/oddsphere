# NFL Player Props qualified-reference priority and fail-safe

## Scope and starting point

This operational/model-safety repair starts from remote `main` commit
`9da922bd1570406d316f8e9a293dd19760f20574`. It preserves the independently modeled point and
probability architecture, the BALLDONTLIE full retail board, last-known-good continuity, the sole
NFL forward writer, the shared `prediction_pipeline:nfl` lease, and every stored lock. It changes
how the already-qualified Receptions market reader obtains and admits Pinnacle/NoVig reference
evidence. No other prop family receives market authority in this release.

BettingPros remains a product-capability benchmark only. It is not a model input, reference book,
or source of canonical lines.

## Production defect and read-only evidence

The live Week 6 board was coherent but the qualified reference lane was not healthy. At the
15:06 UTC production cycle it contained 1,911 board rows, 1,185 member rows, all eight supported
prop families, and 14 games. The 3,462-row observer archive contained zero Pinnacle or NoVig rows,
and `nfl::player-props-reference-offers::2026::6` did not exist after both the 14:06 and 15:06 UTC
cycles.

A credential-backed bounded provider audit at 15:05 UTC found 1,941 reconciled reference
observations—746 Pinnacle and 1,195 NoVig—with 891 complete pairs across all 14 games. The data was
available, but the collector spent its generic Sharp pagination budget before the dedicated
reference requests. A generic catalog failure could therefore crowd out the higher-value lane,
while the writer and cron returned success without surfacing the empty reference cache.

## Repair

The collector now performs three isolated stages in priority order:

1. bounded Pinnacle main-line reference capture;
2. bounded NoVig main-line reference capture; and
3. the lower-priority generic Sharp catalog.

The existing request ceilings remain unchanged. Failure or rate limiting in the generic catalog
cannot erase already-collected references or the BALLDONTLIE retail board. An empty qualified
reference result reports `SHARPAPI_PROPS_REFERENCE_EMPTY`.

The writer enables the Receptions source-aware reader only when the current cycle includes a fresh
qualified Pinnacle or NoVig observation in an eligible market. If that condition is false, the
writer publishes the incumbent complete independent-model board unchanged and reports
`NFL_PLAYER_PROPS_SOURCE_AWARE_REFERENCE_OFFERS_UNAVAILABLE`. Reference-cache persistence failure
is also promoted into cron critical health. This is fail-safe availability behavior, not a second
writer or an alternate forecast path.

## Release identifiers

- Provider observation: `nfl_player_props_provider_observation_2026_10_15_r13_reference_priority`
- Runtime: `nfl_player_props_runtime_2026_10_15_r31_receptions_reference_required`
- Board: `nfl_player_props_board_2026_10_15_r34_receptions_reference_required`
- Model: `nfl_player_props_distribution_model_2026_10_15_r25_receptions_reference_required`
- Calibration: `nfl_player_props_distribution_calibration_2026_10_15_r27_receptions_reference_required`
- Decision: `nfl_player_props_decision_2026_10_15_r30_receptions_reference_required`
- Market reading: `nfl_player_props_market_reading_2026_10_15_r3_reference_required`
- Member: `nfl_player_props_member_2026_10_15_r42_receptions_reference_required`
- Lifecycle: `nfl_player_props_member_lifecycle_2026_10_15_r25_receptions_reference_required`
- Writer: `nfl_player_props_writer_2026_10_15_r52_reference_priority`
- Tracking: `nfl_player_props_tracking_2026_10_15_r30_receptions_reference_required`

The portable independent point artifact remains
`nfl_player_props_runtime_2026_10_09_r14_independent_receiving_yards`; this repair does not change
its features, weights, or outputs.

## Week 6 identity and canonical-line audit

The SELECT-only audit inspected the current live Week 6 snapshot and selected member rows before
any write:

- 1,911 complete board rows, 1,185 member rows, 788 player/market scopes, and 14 games;
- 1,185 canonical rows selected and 726 intentional alternate-line rows retained outside the
  one-main-line member view;
- zero canonical rows missing from the member view;
- zero noncanonical rows in the member view;
- zero provider-ID/name conflicts on the current board;
- zero player-ID/name conflicts, team/opponent mismatches, multiple canonical lines, or duplicate
  book sides.

One historical alias shares provider ID `33934589`: current `Matt Hibner` versus historical
`Matthew Hibner`. Because the provider identity is exact and current joins are coherent, the audit
preserves the alias and every historical lock rather than rewriting it.

## Same-input no-write rehearsal

The repaired Week 6 rehearsal produced 39,967 observations and 16,657 exact offers. It retained
1,946 qualified reference observations (746 Pinnacle, 1,200 NoVig), with 1,946 freshness-eligible
rows, 371 complete Pinnacle pairs, 528 complete NoVig pairs, and 627 effective reference offers.
The source-aware availability gate passed, the reference-cache error was null, all 14 games were
present, and the run stayed within 52 API calls.

Against the incumbent evaluated on the exact same repaired input, 1,184 member rows match. Only
Receptions changes: 198 projections, 12 sides, five actionable promotions, and one actionable
demotion. Member actionables move 29 to 33. Passing Attempts, Passing Completions, Passing Yards,
Receiving Yards, Rushing Attempts, Rushing Yards, and Anytime TD have zero projection, side,
promotion, or demotion changes. The candidate complete board remains 16 Best Angles, 27 Leans,
233 Watchlists, 1,581 No Plays, and 193 held rows, so the release does not flatten coverage.

## Independent per-family continuation

This repair does not treat a working data lane as evidence that every prop should consume it.
Release-pure current-season replay continues independently for each family. The already completed
source-aware challengers remain rejected:

- Passing Attempts: 100 exact scopes, no direction/Brier/MAE improvement; 11 promotions finished
  3-8 and -5.62 units.
- Passing Completions: 77 scopes, no predictive improvement and worse promoted-row economics.
- Passing Yards: 96 scopes, no predictive improvement; 43 promotions finished -4.42 units.
- Receiving Yards: 188 scopes, worse Brier and MAE, zero side improvement, and 100 promotions.
- Rushing Attempts: 145 scopes, only negligible Brier/MAE movement, zero side changes, and negative
  actionable economics.
- Rushing Yards: 79 scopes, one harmful side flip, worse MAE, and -7.94 actionable units.

Those results are not authority to stop research. They are evidence that the next family-specific
candidate must improve the independent role/matchup model or establish a better reference-reading
rule, then clear current-season predictive, calibration, and anti-flattening gates on its own.

## Immutability, publication, and rollback

Locked member snapshots, official tracking rows, opening/T-24/T-6/T-60 observations, prices,
stakes, evidence, and settlements remain unchanged. Reconciliation continues to give stored locks
precedence; this release changes only future unlocked computations. No archive is reconstructed and
no old release is relabeled current.

Publication requires the focused collector/runtime/writer/snapshot tests, `npm run
verify:model-change`, a clean current-main ancestor check, overlap verification, protected PR
checks, and post-deploy proof of the complete release tuple, one writer/lease, nonempty fresh
Pinnacle/NoVig reference capture and cache, stable full-board/member coverage, and unchanged locks.

Roll back future unlocked computation to provider r12, runtime r30, board r33, model r24,
calibration r26, decision r29, market reading r2, member r41, lifecycle r24, writer r51, and
tracking r29 on mixed releases, source-aware evaluation without qualified fresh references,
reference-cache failure, identity mismatch, board collapse, writer overlap, or lock mutation.
Captured research and every stored locked record remain preserved.

## Validation record

Before publication, the collector foundation, portable runtime parity, production contract, and
snapshot/lock suites pass. `npx tsc --noEmit` passes with an 8 GB Node heap after the default 4 GB
heap proved insufficient for the repository-wide program. The complete `npm run
verify:model-change` gate passes, including preverification and every NFL, CFB, MLB, WNBA, NHL,
soccer, tracking, lease, reader, and lock-sensitive suite in that command.
