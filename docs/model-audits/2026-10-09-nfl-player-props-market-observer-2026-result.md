# NFL player props 2026 market observer by prop — result

Date: 2026-10-09

## Decision

Do not apply one generic market-movement adjustment, demotion, or side flip. None of the eight prop
families clears the frozen audit gate. Same-book opening-to-T-60 movement remains useful,
truthfully labeled context, but it has not earned authority over the independent forecast.

This result changes no production model, probability, projection, side, grade, stake, board row,
lock, tracking record, schedule, provider call, copy, label, or layout. The prospective continuation
below changes only the writer release and adds a failure-isolated internal research snapshot.

## Exact scope

The checksum-pinned input contains 207 canonical locked actionable scopes across 47 games in 2026
Weeks 1-4. Opening line and opening price coverage are both 207/207. The market denominators are:

| Market | Weeks 1-2 | Weeks 3-4 | Total |
| --- | ---: | ---: | ---: |
| Passing Attempts | 3 | 13 | 16 |
| Passing Completions | 3 | 3 | 6 |
| Passing Yards | 8 | 6 | 14 |
| Rushing Attempts | 4 | 9 | 13 |
| Rushing Yards | 11 | 17 | 28 |
| Receptions | 29 | 29 | 58 |
| Receiving Yards | 37 | 35 | 72 |
| Anytime Touchdown | 0 | 0 | 0 |

This is not a complete-board sample. Weeks 1-3 lack retained No Play and Watchlist rows, so these
results describe previously selected actions and cannot estimate a promotion rule or full-board
calibration. The newly released independent point models also postdate these locks; the replay
tests market movement relative to the immutable archived picks, not performance of the new releases.

## Frozen chronological result by market

The price floor was selected on Weeks 1-2 and opened once on Weeks 3-4. A line change owns the
state; price direction is used only when the line is unchanged.

| Market | Price floor | W1-2 support / adverse | W1-2 gap | W3-4 support / adverse | W3-4 gap | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Passing Attempts | 1.0pp | 0/1 / 1/1 | -100.0pp | 2/5 / 5/7 | -31.4pp | same contrarian sign, only 13 confirmation rows |
| Passing Completions | 1.0pp | 1/1 / 0/1 | +100.0pp | 0/0 / 0/0 | unavailable | too sparse |
| Passing Yards | 5.0pp | 5/5 / 0/2 | +100.0pp | 0/0 / 3/5 | unavailable | no confirmation support state |
| Rushing Attempts | 1.0pp | 1/1 / 3/3 | 0.0pp | 1/2 / 1/6 | +33.3pp | too sparse; no stable selection sign |
| Rushing Yards | 5.0pp | 1/3 / 0/2 | +33.3pp | 0/1 / 4/6 | -66.7pp | sign reversal |
| Receptions | 1.0pp | 10/18 / 3/7 | +12.7pp | 4/8 / 4/8 | 0.0pp | early signal disappears |
| Receiving Yards | 1.0pp | 11/19 / 6/11 | +3.3pp | 8/13 / 4/11 | +25.2pp | suggestive, but support spans only four games |
| Anytime Touchdown | 5.0pp | 0/0 / 0/0 | unavailable | 0/0 / 0/0 | unavailable | no locked actions |

`wins/rows` are relative to the immutable locked pick. A positive gap means picks with supportive
movement won more often than picks with adverse movement. A negative gap means the apparent move
was contrarian in this archive.

Receiving Yards is the only family with the same favorable sign in both halves and at least 20
confirmation rows. It still fails the predeclared minimum because its 13 supportive confirmation
rows cluster in only four games. Receptions is adequately populated but confirms at exactly the
same 50% rate for supportive and adverse moves. Passing Attempts has at least five games in both
directional states, but its clustered confirmation interval is [-87.5pp, +30.0pp] and fully
flipping adverse rows reduces confirmation accuracy from 61.5% to 38.5%.

No family is production-qualified. The result also rejects pooling: combining these markets would
hide the Rushing Yards sign reversal, the Receptions null result, and the contrarian Passing
Attempts behavior.

## What the archive cannot answer

The frozen export does not retain opening observation timestamps, intermediate T-24/T-6 snapshots,
a distinct post-T-60 close, player position, source class, or complete opposing-side prices. It
therefore cannot prove timestamp health, distinguish an early move from a late move, estimate
T-60-to-close behavior, calculate no-vig price movement, test position stability, or call a source
sharp. Those fields may exist in newer live evidence, but they are not reconstructable for this
locked four-week cohort and must not be invented.

The smallest sufficient next dataset is the already planned immutable complete-board sequence for
each future slate, with exact sportsbook/player/game/market/side/line identity at opening, T-24,
T-6, and T-60; paired side prices; source class; player position; independent release; and eventual
official outcome. Target/execution movement and target-excluded sharp/retail observations must stay
separate. This requires no new per-card provider loop if the existing slate-level capture persists
the fields it already sees.

## Prospective capture implementation

Writer `nfl_player_props_writer_2026_10_09_r47_market_observer_capture` now appends the missing
forward evidence to the separate internal key
`nfl::player-props-market-observer::<season>::<week>`. It runs only after the coherent member
snapshot, locked tracking rows, closing-price update, and settlement have completed. It consumes
the already-built bounded market-evidence tuples and makes zero additional provider requests.

For every canonical complete-board identity, it can retain each same-book true provider opening,
T-24, T-6, and T-60/lock tuple with exact player/game/family/line, target-side mask, paired prices,
source class, position, provider observation/fetch times, and model/capture releases. Provider
opening requires a real opening timestamp, line, and complete opening prices. Missing opening is
reported as missing and never replaced with first observed. T-60 is the product lock, so no
post-T-60/pre-lock close is fabricated.

Rows are deterministic and append-only. Same-cycle replay writes nothing; a later conflict keeps
the first stored landmark; later cycles may only add a missing book or landmark. No row is added
after kickoff. The store rejects source-time reversal, incomplete price pairs, stale retained lock
quotes, corrupt checksums, more than 24,000 rows, more than 32 MB decoded JSON, or more than 2 MB
gzip. Capture read/write/size failures return telemetry and the health finding
`NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_FAILED`; they cannot fail or mutate the already-completed
production outputs.

## Next validation

For each prop family independently:

1. Keep the frozen movement definition and record missingness at every time landmark.
2. Use complete-board rows so a supportive promotion can be evaluated beside an adverse demotion;
   report actionables and board size rather than suppressing picks.
3. Fit on one completed release-pure window and confirm on a later untouched window under the new
   independent model release.
4. Require improvement in direction, Brier, and log loss, stable weekly/position behavior, and
   game/player-clustered uncertainty before any confidence adjustment or flip.
5. Treat missing, cross-book, post-lock, or unpaired evidence as neutral.

Receiving Yards is the first market worth retesting when that denominator exists; it is not a live
rule today. Passing Attempts should explicitly include a contrarian/no-adjustment candidate rather
than assume that movement is predictive. Every other family retains its own null baseline.

## Reproduction

```bash
python3 scripts/operator/audit_nfl_player_props_2026_market_observer_by_prop.py \
  --output /private/tmp/nfl-player-props-market-observer-r1.json

npx tsx scripts/test-nfl-player-props-market-observer-store.ts
```

Input release: `nfl_player_props_2026_locked_replay_rows_2026_10_08_r1`  
Input SHA-256: `bd90c70f689e1ba44035b2e2e36236381eda81359162f61b3678ae75a11dec8f`
