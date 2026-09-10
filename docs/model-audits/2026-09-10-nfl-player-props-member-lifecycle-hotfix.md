# NFL player props member lifecycle hotfix — 2026-09-10

## Scope and authority

- Affected sport and surface: NFL Player Props member reader and presentation filtering.
- New reader lifecycle: `nfl_player_props_member_lifecycle_2026_09_10_r1_overnight_rollover`.
- Current model/calibration/decision/board/member snapshot/writer releases remain the September 7 registry set. Their predictions, probabilities, projections, grades, prices, locks, and immutable evidence do not change.
- The sole production writer remains `nfl_player_props_writer_2026_09_07_r20_identity_capacity` inside the existing `nfl-forward-evidence` cron under `prediction_pipeline:nfl`.
- No provider call, cron, database query, database write, schema, stake, settlement rule, or independent refresh path is added.

## Incident and root cause

The weekly canonical snapshot intentionally preserves locked rows for tracking and settlement. The member-only projection of that snapshot did not apply an overnight board rollover, so prior-date locked rows remained visible alongside the next betting board. Separately, interactive filters drove only the full-board table; Today’s Radar, the research count, and an already-open reader continued using the unfiltered member row set.

The repair keeps canonical locked evidence byte-for-byte intact and filters only the member DTO. A row remains member-eligible through its Eastern game date and the overnight tracking window; the prior game date rolls off at 2 a.m. ET. The bounded 60-second cache refresh means the new board appears no more than one minute after the boundary without adding queries or timers. Every interactive surface derives from the same filtered rows, changing a filter closes a reader that may no longer be eligible, and the paired full board uses the selected sort rather than always re-sorting by signal.

## Frozen production impact

A SELECT-only audit of the current Week 1 snapshot at `2026-09-10T14:35:11.334Z` found:

- Snapshot generated at `2026-09-10T14:21:09.777Z` under member snapshot release `nfl_player_props_member_2026_09_07_r17_out_of_support_hold`.
- 2,474 canonical member decisions across 16 games.
- 172 prior-Eastern-date NE–SEA rows at the `2026-09-10T00:20:00.000Z` kickoff: 0 Best Angles, 1 Lean, 13 Watchlists, and 158 No Plays.
- 2,302 current/future-date rows across 15 games: 12 Best Angles, 79 Leans, 320 Watchlists, and 1,891 No Plays.
- The single NE–SEA actionable has one immutable tracking record and was already settled as a loss before this publication.

The reader-only boundary removes the 172 ineligible rows. It produces zero grade promotions, zero grade demotions, zero side changes, and zero value changes among the 2,302 eligible rows. The rolled-off Lean remains in immutable tracking/history; it is no longer presented as a live betting opportunity.

## Verification and rollback

Required proof includes the focused snapshot-store lifecycle/cache-boundary tests, the production contract/filter/sort regression, NFL market/runtime/evidence tests, TypeScript, focused lint, `npm run verify:model-change`, a production build, latest-main integration safety, protected PR checks, and live proof that NE–SEA is absent while all 15 current/future games and functioning sort controls remain available.

Rollback is the preceding unversioned member reader behavior only. It must not rewrite the weekly snapshot, locked rows, tracking rows, or settlement evidence. Roll back or disable member visibility if the eligible board diverges from the canonical future cohort, the member route errors, or site/Supabase health degrades.
