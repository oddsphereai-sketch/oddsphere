# Football Daily Edge availability recovery — predeclaration

Date: 2026-09-13

## Incident

- NFL Daily Edge returned zero games because the Week 1 BALLDONTLIE schedule still contained
  completed games whose current odds had been removed. The slate adapter rejected the entire
  verified schedule before the writer's existing per-game isolation could preserve healthy games
  and refresh the compact member snapshot.
- CFB Daily Edge returned zero games after the September 10–14 window rolled off. The September
  17–21 window contains 101 model-covered games, while 100 currently request supplemental
  SharpAPI named-book enrichment. The fallback rejects more than 96 exact games before collection,
  preventing the complete opening wave and compact snapshot from publishing.

## Intended change

1. Keep the complete verified NFL schedule when current odds are absent for individual games.
   The existing writer plans only unstarted games, contains exact-price failures at game scope,
   preserves prior immutable evidence for completed games, and publishes only from a complete
   current-release weekly wave.
2. Bound CFB supplemental exact-event odds enrichment to a deterministic 24-game slice per writer
   invocation, prioritizing games without retained canonical SharpAPI identities and then kickoff.
   The optional enrichment has a 40-second whole-attempt deadline so a slow supplemental provider
   cannot consume the five-minute writer route budget.
   All 101 model-covered games continue through the existing football forecast, append, tracking,
   and compact-snapshot path in the same invocation. Missing exact-price evidence remains an
   explicit market-level No Play; it cannot erase the game's live model prediction.
3. Remove the game-level `holdReason` from a CFB card when all three model predictions are live but
   their exact-price decisions are unavailable. Market availability and No Play truth remain
   visible. This prevents the product from describing a live prediction as a held game.

## Release and safety contract

- NFL slate adapter / sole writer / compact snapshot become
  `balldontlie_nfl_regular_slate_2026_09_13_r3_game_scoped_odds_gaps`,
  `nfl_forward_evidence_writer_2026_09_13_r23_game_scoped_odds_gaps`, and
  `nfl_forward_member_snapshot_2026_09_13_r8_game_scoped_odds_gaps`.
- CFB sole writer / member fixture / compact snapshot become
  `cfb_forward_evidence_writer_2026_09_13_r57_bounded_week_ahead_recovery`,
  `cfb_v1_member_fixture_2026_09_13_r52_live_prediction_visibility`, and
  `cfb_forward_member_snapshot_2026_09_13_r10_live_prediction_visibility`.
  Supplemental odds release becomes
  `cfb_sharpapi_named_book_fallback_2026_09_13_r12_bounded_writer_deadline`.
- The existing `nfl_forward_evidence` and `cfb_forward_evidence` jobs remain the sole writers under
  their sport-scoped `prediction_pipeline` leases. No writer, table, manual prediction path, or
  provider identity is added.
- No score model, PMF, calibration, side, probability, grade ladder, promotion/demotion rule,
  execution rule, stake, T-60 boundary, tracking eligibility, or settlement behavior changes.
  Same-input actionable promotions and demotions are therefore zero. Coverage can increase from an
  unavailable board to the complete verified scheduled board; unavailable exact-price markets stay
  No Play and cannot become actionable.

## Required proof before production

- Focused NFL slate/writer/snapshot and CFB weekly/provider/fixture/snapshot tests.
- A no-write live replay showing the complete current NFL wave and all 101 model-covered CFB games
  survive the writer path inside the production duration budget.
- `npm run verify:model-change`, TypeScript, lint/build, clean fresh-main ancestry, integration
  safety, protected PR checks, merge, then live writer/lease/snapshot/browser verification.

Rollback all release identifiers above together if a complete scheduled game disappears, a partial
release wave becomes authoritative, exact-price absence creates an actionable decision, writer
duration breaches the route budget, or either member reader becomes unavailable.

## NFL production follow-up predeclaration

The first r23 production invocation passed the provider-odds boundary and then failed while reading
the 1,567-row current evidence release: Postgres canceled the 1,000-large-JSON-row page at its
statement timeout. The r24 writer reads only the current authoritative release and reduces each page
to 250 rows; superseded r4/r3/r2 evidence has no current publication authority and is no longer
loaded by the scheduled writer. Snapshot r9 may read the immediately preceding r8/r7 compact Week 1
snapshot for at most eight days, while the unchanged daily lifecycle hides prior-date games. This
restores the last complete Sunday board without a write and lets the next successful r24 invocation
replace it. Forecasts, tuples, grades, actionability, locks, tracking, stakes, and settlement remain
unchanged; same-input promotions and demotions remain zero. Roll back r24/r9 together if current
release coverage is incomplete, the bounded read still times out, or continuity exposes a past game.

## CFB production follow-up predeclaration

The first r57 production invocation retained the complete provider window but still died before
lifecycle close because it loaded 12,024 season-long large JSON evidence payloads. Writer r58
loads the lightweight season-long game identity/date trail used by the unchanged prior-results
planner, then retrieves only the checksum-verified latest current-release payload for each game
and capture stage.
This preserves prior-result/model context, current release authority, immutable locks, and the
single append/snapshot path while removing repeated and superseded payload transfer. No model,
side, probability, grade, actionability, stake, or tracking rule changes; same-input promotions
and demotions remain zero. Roll back r58 if the latest-row set is incomplete, checksums fail, a
prior game identity disappears, or the writer still exceeds its route budget.

## Public football tracking reader follow-up

The official modern tables contain 266 CFB records from the August 29 launch boundary: 167 wins,
97 losses, and 2 pushes, with all 266 graded. The public tracker omitted them because its modern
grade bridge covered WNBA and soccer only; NFL was omitted by the same reader gap. The tracking
route now bridges settled NFL and CFB `prediction_records` / `prediction_grades` rows at their
existing public launch dates and exposes the already-official CFB Spread category. This changes no
prediction, grade, result, release, model, stake, lock, or stored row; it only reads and aggregates
the existing official truth.

## Owner-approved balanced value containment

After live r58 isolated provider game 457274 as the only missing September 17–21 opening row, the
owner explicitly approved containing its invalid Moneyline action so the game and every model
prediction remain visible. Candidate / production grade releases advance to r17 / r19 and the sole
writer advances to r59. An actionable Bet with negative EV or a nonpositive target-excluded
probability gap becomes Watchlist. The paired tested promotion retains the already approved
market-specific probability, edge, EV, price, line-size, and resistance-free gates: an eligible
probability-grade Watchlist can become Lean only when all positive-value gates pass. No side,
probability, projection, calibration, stake, T-60, result, or settlement rule changes. The frozen
September 17–21 live-input replay completed in 138.4 seconds and covered all 101 games with zero
capture failures. It produced zero balanced-rule promotions, zero balanced-rule demotions, 2
actionable Leans, 0 Best Angles, 7 Watchlists, 2 No Plays, and 292 held markets. This is no net
actionable-board change on the frozen input while preserving both sides of the tested rule.
Rollback r17/r19/r59 together if coverage is incomplete, actionability unexpectedly collapses, or
any resistance-bearing/negative-value market promotes.
