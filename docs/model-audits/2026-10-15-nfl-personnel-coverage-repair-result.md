# NFL personnel coverage repair — result

Date: 2026-10-15

## Decision

Advance the r33 personnel coverage release for future unlocked NFL rows. The correction removes two
false Week 6 holds while retaining the existing fail-closed boundary for genuinely missing reports
and quarterbacks without exact pregame history. It does not change a forecast coefficient,
calibration function, market-reader rule, threshold, stake, writer topology, cadence, or locked row.

## Root causes proved

### Tampa Bay replacement quarterback

The depth feed correctly marked Baker Mayfield Out and selected Jalon Daniels, provider player ID
`33934062`, as the healthy replacement. The old gate nevertheless required Daniels to exist in a
frozen preseason identity artifact, which cannot contain a 2026 rookie. The already-authoritative
current-season state contains Daniels under that exact player ID and team with 55 passing attempts
in completed Weeks 3-5, all strictly before the Week 6 prediction.

The repair keeps frozen quarterback state first. Only when that identity is absent may the exact
current-season player ID, exact team, and completed prior-week passing attempts satisfy the history
gate. Daniels is now stored as `current_season_completed_games`; wrong-player, wrong-team, zero-
attempt, same-week, future-week, and missing-state cases remain unmatched and held.

### Washington-San Francisco injury report

The designation endpoint returned 167 exact-game player rows for WSH-SF with provider timestamp
`2026-10-15T21:30:05.381Z`. Every latest row normalized to healthy/full participation, producing no
reportable injury players. The old continuity layer treated that verified clear report exactly like
an omitted response and returned null.

The repair preserves a `verifiedClear` state only when exact-game source rows exist for both teams.
A one-team or complete row omission remains unavailable and cannot erase the last verified report. Transient
network/408/425/429/5xx failures also receive at most two retries per team batch; persistent failures
retain the existing unresolved-game fallback.

## Zero-write Week 6 rehearsal

The provider/read-only rehearsal proposed 14 rows and inserted zero.

| Measure | Same-input legacy behavior | Candidate |
| --- | ---: | ---: |
| Games | 14 | 14 |
| Evaluated markets | 36 | 42 |
| Held games | 2 | 0 |
| Actionables | 19 | 22 |
| Moneyline actionables | 6 | 7 |
| Spread actionables | 7 | 8 |
| Total actionables | 6 | 7 |
| Promotions | — | 3 |
| Demotions | — | 0 |

Exactly six market slots change from held/null to evaluated on the same captured inputs. The three
actionable promotions are PIT Moneyline, SF Spread, and WSH-SF Over; PIT Spread and Total become
Watchlists, and SF Moneyline becomes an evaluated No Play. No previously evaluated same-input side,
probability, projection, or grade changes.

The candidate records:

- `PIT@TB`: Jalon Daniels is the effective Tampa Bay quarterback with exact current-season history;
  no health hold. Projection PIT 22.83, TB 19.86. PIT Moneyline is a 58.58% Lean; PIT -2.5 is a
  51.36% Watchlist; Over 39.5 is a 56.33% Watchlist.
- `WSH@SF`: injury evidence is available and `verifiedClear`; both quarterbacks retain frozen-
  artifact identity and there is no health hold. Projection WSH 21.51, SF 31.92. SF Moneyline is an
  evaluated 77.34% No Play at its exact price; SF -7.5 is a 58.09% Lean; Over 51.5 is a 53.00% Lean.

These are current-board decisions, not historical wins or promised accuracy.

## Release and safety contract

- Member/model/calibration/decision/grade: r33/r28/r27/r36/r36.
- Collector/writer/fixture/snapshot: r22/r63/r45/r37.
- Shadow eligibility schema/decision wrapper: r2/r7; frozen artifact/model/calibration remain r1/r6/r6.
- Availability maximum: 20 calls per team batch, including both transient retries for designation
  and legacy paths. The complete writer's declared maximum is 93 calls on the audited slate.
- One `prediction_pipeline:nfl` lease and one writer remain authoritative.
- Snapshot r36/member r32/decision r35/fixture r44 is the immediate immutable predecessor; r35/r31/
  r34/r43 and all earlier bounded predecessors remain readable without reconstruction.

Rollback the complete r33 release family on a future-only quarterback match, unknown-player pass,
verified-clear false positive, request-budget overrun, mixed release, unexpected board contraction,
reader failure, writer overlap, or any difference in a previously locked payload.
