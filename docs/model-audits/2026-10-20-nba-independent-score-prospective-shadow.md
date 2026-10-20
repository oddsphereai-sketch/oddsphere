# NBA independent score prospective shadow

Date: 2026-10-20

Status: superseded in prospective capture by the r2 alpha-300 compression
shadow documented in `2026-10-20-nba-margin-compression-repair-result.md`.
This r1 record remains the immutable audit history. No production score, pick,
probability, grade, stake, promotion, demotion, lock, or tracking authority.

## Frozen candidate

The chronological research audit selected a 30% adjusted-rating contribution
to the incumbent margin and a 20% adjusted-rating contribution to the incumbent
Total before the 2025 confirmation season was opened. On 1,230 confirmation
games it improved team-score MAE from 9.5620 to 9.5364, margin MAE from 11.3705
to 11.3168, Total MAE from 15.2235 to 15.2117, winner direction from 68.13% to
68.21%, winner Brier from 0.20508 to 0.20372, and predicted-margin dispersion
from 6.879 to 7.224 points. It failed the predeclared candidate-defined
under-three-point winner gate (55.56% versus 57.51%) and therefore has no
promotion authority.

A post-confirmation same-game diagnostic found that the candidate improved the
incumbent's fixed 386-game close cohort from 57.51% to 57.77% winner accuracy
and reduced its margin MAE from 11.8505 to 11.7767. That diagnostic explains
the cohort-membership effect but cannot override the failed frozen gate.

## Prospective capture contract

The existing NBA Daily Edge runtime computes the frozen candidate beside the
incumbent. It passes the candidate through a separately target-excluded copy of
the same professional market reader, so a changed candidate side cannot reuse
the incumbent side's execution-book exclusion. The candidate score, final
reader-adjusted score, picks, probabilities, reader payload, and reader decision
are stored only inside `snapshot_json.nba_grounding_audit.independent_score_shadow`
for future unlocked rows. The public candidate and every locked legacy payload
retain exact incumbent precedence.

The shadow fails open: absent adjusted-rating or pace inputs omit the candidate
without blocking the production board. It performs no provider call, creates no
writer, adds no lease, changes no cadence, and makes no database-schema change.

## Adjudication

Settled rows must be evaluated release-pure by the locked timestamp. Promotion
requires a separate predeclaration and a meaningful prospective sample showing
non-regression in team-score, margin, Total, winner calibration, main Spread,
alternate +3/+6 Spread, Total direction, and actionable board counts. Reader
corrections must also be separated into qualified, confirming, opposing, and
inactive cohorts. A failed or inconclusive sample leaves the current r9/r6
production model-reader family unchanged.

Rollback removes only the shadow builder and stored future shadow field. Stored
locked production predictions are never rewritten.
