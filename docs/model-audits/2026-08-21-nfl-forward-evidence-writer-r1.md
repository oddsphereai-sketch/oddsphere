# NFL forward evidence writer — 2026-08-21 r1

## Scope and non-promotion decision

This release closes the forward-evidence and writer-ownership blocker for NFL
Regular Season Week 1. It does **not** promote the failed NFL score model, does
not replace the public board, does not change a probability or grade, and does
not write a tracked wager.

The scheduled route is evidence-only while the independent prediction gates
remain frozen. Its response and stored payload both record that publication and
tracking were not attempted.

## One authoritative collection path

- Route: `/api/cron/nfl-forward-evidence`
- Lease: `prediction_pipeline:nfl`, required and fail-closed
- Writer: `nfl_forward_evidence_writer_2026_08_21_r1`
- Evidence schema: `nfl_forward_evidence_snapshot_2026_08_21_r1`
- Database: append-only `nfl_forward_evidence_snapshots`
- Activation: `NFL_FORWARD_EVIDENCE_ENABLED=true`
- Slate selection: `NFL_FORWARD_SEASON` and `NFL_FORWARD_WEEK` (defaults are
  2026 and Week 1)

The route is the only scheduled NFL forward writer. Existing filesystem
operator scripts remain local research tools and are not production writers.

## Immutable horizons and inputs

For every regular-season game the writer stores:

1. The first collected opening snapshot. A real provider opening is preserved
   as `provider_opening`; when unavailable, the earliest named-book observation
   is explicitly recorded as `first_observed`. Those meanings are never mixed.
2. Bounded unlocked observations for forward line and context history.
3. The first observation at or after T-60 and before kickoff. The row records
   its exact lag from T-60; lag above 20 minutes is a health hold.

Opening and T-60 each have a database uniqueness constraint per game and
evidence release. The service role receives only `SELECT` and `INSERT`; it does
not receive update or delete permission.

Each snapshot carries the current named-book quote, provider/operational
opening, Playbook lines and public splits, strictly NFL-matched SharpAPI splits,
BALLDONTLIE roster/depth and expected-QB evidence, BALLDONTLIE injuries, venue
weather state, coverage flags, request budget, release IDs, timestamp, and a
deterministic SHA-256 checksum.

## Cost and cadence controls

The scheduler wakes every 15 minutes so it cannot miss the T-60 boundary, but
the database preflight prevents routine provider calls on each wake:

- More than 48 hours from the next unlocked game: at most every 6 hours.
- Inside 48 hours: at most hourly.
- At the first T-60-due wake: immediate collection.
- Roster/depth requests: only for teams requiring opening or T-60 snapshots.
- SharpAPI: one bounded `/splits?sport=nfl&limit=200` call per collection.
- Playbook: one NFL lines call and one NFL splits call per collection.
- Weather: opening only inside the five-day forecast horizon, plus T-60;
  controlled indoor games use venue state without an API call.

Provider absence is captured as an explicit health hold. It is never converted
to an ordinary no-play grade.

## Exact-price decision and tracking boundary

The separate evaluated-decision contract freezes one coherent tuple:

- model probability;
- evaluated sportsbook, line, price, and quote timestamp;
- market fair probability;
- grade;
- evaluation/lock time;
- model, calibration, and decision releases.

Unlocked material price movement requires an authoritative writer refresh. A
post-T-60 current quote is context-only. Outcome confidence remains explicitly
non-actionable.

The new tracking boundary accepts exactly three unique T-60 tuples per published
game, rejects unknown games and mixed lock/release tuples, and copies the frozen
evaluated price into tracking. It cannot reconstruct a bet from a later reader
quote. Both tuple construction and tracking reject a lock captured more than 20
minutes after T-60; the collector uses that same exported constant for its late
capture health hold. The boundary is not called by the evidence-only writer.

## Remaining promotion gate

Public NFL Week 1 predictions remain blocked until an independent chronological
candidate passes the frozen projection, calibration, exact-price portfolio, and
board-impact gates required by `docs/model-change-safety.md`. Passing this
writer audit is necessary infrastructure; it is not evidence that the current
NFL model is predictive.
