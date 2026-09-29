# NFL Week 4 player-props injury-feed continuity

Date: 2026-09-29  
Status: owner-approved emergency production repair

## Problem

The Week 4 Daily Edge forward bundle was complete for all 16 games, but the future injury endpoint
returned no payload for any game. The player-props inference context treated a never-observed injury
payload as a fatal per-game exclusion. All 16 games were therefore removed before scoring and the
member snapshot remained on Week 3.

## Repair

- Continue using the latest verified injury payload for the exact provider game, including the
  already-released last-known exact-game continuity path.
- If no injury payload has ever been returned for a future game, retain the game only when its
  forward evidence, game identity, roster/depth, and current main market are complete.
- Record the missing injury evidence internally for every affected game. Do not fabricate players,
  timestamps, report completeness, member copy, labels, or warnings.
- Score only players supported by current exact prop offers and current roster/depth identity.
- Let any subsequent verified injury payload silently take priority. Existing out/inactive/IR holds
  remain unchanged.
- Preserve the single NFL writer, `prediction_pipeline:nfl` lease, provider ceiling, current-season
  state, target exclusion, market evidence, projections, posterior, prices, grades, lock, tracking,
  settlement, and presentation.

## Zero-write Week 4 evidence

Run: 2026 season, Week 4, current production providers and stored forward evidence.

| Measure | Result |
| --- | ---: |
| Games retained | 16 / 16 |
| Exact offers | 5,483 |
| Runtime feature rows | 406 |
| Score-eligible feature rows | 339 |
| Canonical member rows | 611 |
| Best Angle / Lean / Watchlist | 1 / 5 / 50 |
| No Play / internal Held | 811 / 124 |
| Actionables | 6 |
| Provider calls | 46 |
| Collection ceiling | 51 |

The preceding strict path produced no Week 4 snapshot. Against the same full-family calculation,
the continuity path changes no grade rule and produces zero promotions and zero demotions; it
restores the otherwise missing slate. It adds no provider request.

## Release family

- portable artifact: `nfl_player_props_runtime_2026_09_29_r6_full_family_matchup` (unchanged)
- model: `nfl_player_props_distribution_model_2026_09_29_r15_injury_feed_continuity`
- calibration: `nfl_player_props_distribution_calibration_2026_09_29_r16_injury_feed_continuity`
- decision: `nfl_player_props_decision_2026_09_29_r19_injury_feed_continuity`
- runtime / board: `nfl_player_props_runtime_2026_09_29_r20_injury_feed_continuity` /
  `nfl_player_props_board_2026_09_29_r23_injury_feed_continuity`
- member / lifecycle: `nfl_player_props_member_2026_09_29_r30_injury_feed_continuity` /
  `nfl_player_props_member_lifecycle_2026_09_29_r13_injury_feed_continuity`
- writer / tracking: `nfl_player_props_writer_2026_09_29_r35_injury_feed_continuity` /
  `nfl_player_props_tracking_2026_09_29_r18_injury_feed_continuity`
- inference context: `nfl_player_props_inference_context_2026_09_29_r7_injury_feed_continuity`

## Acceptance and rollback

Acceptance requires focused props tests, full model-change verification, clean build, latest-main
integration safety, protected PR checks, successful production writer publication, a Week 4 member
snapshot with all games represented by available exact markets, unchanged provider ceilings, and a
healthy member reader. Roll back the complete unlocked continuity family if coverage is empty or
partial, releases mix, load rises, locked rows change, the lease overlaps, or the reader fails.
