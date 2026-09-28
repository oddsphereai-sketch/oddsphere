# NFL player props current-role and coherent-posterior repair — result (2026-09-28)

## Outcome

The candidate qualifies for publication as a role/freshness and posterior-coherence repair. It
does not claim that the broader grade ladder has been newly validated; that research remains
separate. The change adds no provider call, writer, timer, stake, member copy, label, or layout.

## Established production defect

The production Week 3 snapshot at `2026-09-28T21:10:45.175Z` retained 2,127 member rows and
contained 69 ordinary rows whose displayed projection direction disagreed with the row's own
posterior probability. Case Keenum was the clearest role failure: the shared context expected
Caleb Williams from a September 22 depth capture and applied Keenum's September 20 inactive note
from the preceding Minnesota game to the September 28 Philadelphia game. That produced a 15.7
passing-yard projection against a 170.5 line even though the current slate contained a multi-book
starter-scale Keenum passing market.

## Candidate behavior

- A game-scoped `out` / `inactive` observation reported more than six days before the scheduled
  game is not allowed to describe that next game's availability. A current observation remains
  authoritative, and persistent injured-reserve designations do not expire under this rule.
- A unique rostered quarterback with a starter-scale passing-yards or passing-attempts market at
  two or more current books becomes the projected quarterback for that game/team. This is a
  target-free current-role inference from the already-collected slate bundle and does not add a
  provider request.
- Every ordinary published projection is the median of the exact same empirical posterior that
  supplies its Over/Under probability. The independent point estimate remains stored as evidence,
  while side, displayed projection, probability, exact-price EV, and downstream grade cannot
  contradict one another.

## Complete Week 3 no-write replay

The bounded production replay completed in 19.8 seconds with zero database writes:

- 42,957 observations; 1,494 exact offers; 357 feature rows.
- Score-eligible feature rows: 303, versus 291 in the preceding live cycle.
- 2,127 canonical member rows retained.
- Full retained board: 25 Best Angles / 36 Leans / 328 Watchlists / 2,587 No Plays / 309 internal
  Held rows; 61 total actionables. The preceding live cycle had the same 61 actionables, so the
  repair did not flatten the board.
- 137 of 143 passing-yard rows had target-excluded point consensus; six remained non-actionable
  without that evidence; zero unlocked passing-release mismatches.
- Provider ceiling remained 47 and current-season state calls remained zero.
- The existing writer and `prediction_pipeline:nfl` lease remain authoritative. Prior locked rows
  remain immutable under their preceding releases.

## Release family

- model `nfl_player_props_distribution_model_2026_09_28_r11_current_role_coherent_posterior`
- calibration `nfl_player_props_distribution_calibration_2026_09_28_r12_current_role_coherent_posterior`
- decision `nfl_player_props_decision_2026_09_28_r15_current_role_coherent_posterior`
- runtime `nfl_player_props_runtime_2026_09_28_r16_current_role_coherent_posterior`
- board `nfl_player_props_board_2026_09_28_r19_current_role_coherent_posterior`
- member `nfl_player_props_member_2026_09_28_r26_current_role_coherent_posterior`
- lifecycle `nfl_player_props_member_lifecycle_2026_09_28_r9_current_role_coherent_posterior`
- writer `nfl_player_props_writer_2026_09_28_r31_current_role_coherent_posterior`
- tracking `nfl_player_props_tracking_2026_09_28_r14_current_role_coherent_posterior`

Rollback the complete family together if live proof finds a current-role error, a current-release
projection/probability contradiction, missing member coverage, an actionable collapse, mixed
unlocked releases, writer overlap, or reader instability. Preserve all previously locked rows.
