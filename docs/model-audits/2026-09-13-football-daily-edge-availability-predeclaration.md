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
