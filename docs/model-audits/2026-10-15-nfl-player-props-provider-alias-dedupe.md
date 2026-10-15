# NFL player props provider-alias canonical-row deduplication

Date: 2026-10-15
Decision: production correctness repair for future unlocked member rows

## Trigger

The first credential-backed r54 cycle successfully persisted 636 Pinnacle/NoVig reference offers
and published a healthy 1,211-row Week 6 member snapshot. The independent identity/line audit found
one duplicate sportsbook-side row:

- `Marvin Mims Jr.` from BALLDONTLIE and `Marvin Mims` from SharpAPI;
- same game, team, Receptions market, 1.5 line, BetMGM Under -160;
- same market-evidence identity;
- both `No Play`.

The existing scope key already normalizes suffix aliases, but canonical-line selection retained
every provider row at the chosen line. That allowed two source renderings of one sportsbook quote
to survive into the member board.

## Repair

Within each normalized game/player/team/market scope, canonical selection still chooses one main
line by the existing cross-book rules. At that line it now retains one row per normalized
sportsbook and side. The newest provider observation wins; an exact timestamp tie chooses the
better American price. Internal board decisions and alternate-line evidence remain preserved.

Previously locked member rows are not passed through the new selector and remain byte-for-byte
unchanged. The repair does not alter a projection, probability, forecast side, grade, stake,
threshold, provider call, reference source, cadence, or public copy.

## Release and acceptance

- Member: `nfl_player_props_member_2026_10_15_r44_provider_alias_dedupe`
- Sole writer: `nfl_player_props_writer_2026_10_15_r55_provider_alias_dedupe`
- Model, calibration, decision, runtime, board, tracking, and settlement releases remain unchanged.

The focused contract test reproduces the exact suffix-alias/provider collision and proves that the
fresh BALLDONTLIE row is retained once per side. A credential-backed SELECT-only replay of the
17:07 UTC Week 6 snapshot moves the canonical member board from 1,211 to 1,210 rows by removing
only that duplicate `No Play`: Best Angle / Lean / Watchlist remain exactly `12 / 16 / 149`, and
actionable rows remain 28. The source snapshot contains zero locked rows, so the candidate neither
rewrites nor reconstructs a lock.

Production acceptance requires the normal shared
`prediction_pipeline:nfl` lease, unchanged actionable counts, zero canonical/member set mismatch,
zero duplicate sportsbook sides, and no locked-row reconstruction.

Rollback returns future unlocked member selection to r43/r54. Any locked r44 row remains immutable.
