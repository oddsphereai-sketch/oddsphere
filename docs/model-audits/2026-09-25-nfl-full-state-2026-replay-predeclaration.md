# NFL full-state 2026 score replay predeclaration

Date: 2026-09-25

Replay: `nfl_full_state_2026_score_replay_2026_09_25_r1`

Status: read-only research; no production authorization

This replay tests the remaining weekly-engine gap: the rich pre-week team state
used in historical research has not been updated with current-season
play-by-play after Week 1. The replay downloads one checksum-recorded official
nflverse 2026 play-by-play artifact into local research cache, never from a
member request, and applies only completed prior weeks.

The score recipe is frozen before opening the 2026 output: the r1-selected
orientation-symmetric ridge-100 team-score estimator, refit through 2025, with
10% independent and 90% market calibration applied to both team scores. The
post-2025 state receives the existing 65% offseason carry. Fast, slow, and
opponent-adjusted offense/defense EPA, pass EPA, rush EPA, success, explosive,
sacks, turnovers, plays, red-zone rate, pace proxies, and points are updated
with the existing 0.35/0.16 rules only after each complete week. Within-week
games remain isolated.

Current QB, injury, continuity, rest, venue, and weather fields that cannot be
mapped exactly to the historical feature semantics are missing and handled by
the frozen estimator's training median. They may not be copied from another
team or future row. This limitation must be reported.

The replay uses immutable T-60 lines/prices and original settled outcomes for
Weeks 1-2. It reports score error, ML/spread/total direction, Brier, action
economics, and comparison to the published release. A candidate failing any
score, total, calibration, direction, or stability gate remains out of
production. No parameter or side may be retuned after results are opened.
