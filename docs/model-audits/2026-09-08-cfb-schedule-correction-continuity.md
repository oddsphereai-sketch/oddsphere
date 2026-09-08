# CFB schedule-correction continuity and member-reader recovery

Date: 2026-09-08

## Scope and production authority

- Sport: CFB.
- Markets: Moneyline, Spread, and Total; no market or grade rule changes.
- Active model / calibration / decision remain the identifiers registered in `docs/current-model-releases.md`.
- Writer changes from `cfb_forward_evidence_writer_2026_09_05_r54_per_game_lock_isolation` to `cfb_forward_evidence_writer_2026_09_08_r56_week_ahead_schedule_continuity`, incorporating the separately predeclared overlapping week-ahead publication behavior.
- The only write path remains `/api/cron/cfb-forward-evidence` under the shared `prediction_pipeline:cfb` lease.
- Starting production base: `87582ed21a8483f53a7666dc9072c5b37d6295dd`.

## Incident evidence

The live member route reproduced as `Loading…` for roughly 40 seconds and then rendered an empty unavailable board. The last compact CFB member snapshot was generated at `2026-09-07T23:24:48.538Z` and its original eight-hour database stale marker ended at `2026-09-08T07:24:48.538Z`.

Every inspected natural writer run on September 8 failed with `CFB prior game 458875 has conflicting persisted dates.` Immutable rows show Illinois State at Western Illinois first scheduled at `2026-09-05T23:00:00Z`, then corrected by the same provider to `2026-09-06T00:00:00Z`. The one-hour correction crossed a UTC calendar boundary. No game identity, opponent, prediction, price, or result conflict was observed.

## Repair

Prior-result planning now chooses the date from the newest immutable capture for each exact provider game ID. Input order does not affect selection. Different dates at an identical capture timestamp remain fatal. The selected result query still carries the exact game ID, retains the existing three-date / 100-ID batching, and adds no provider request.

The member route now reads only the compact snapshot. It never performs the full season reconstruction during a request. Compact continuity is bounded to eight days by payload `publishedAt`; the normal weekly reader lifecycle removes games before the current CFB board date. A compact storage failure reaches the explicit unavailable state within four seconds.

## Same-input impact and safety

- Promotions: 0.
- Demotions: 0.
- Net actionable change: 0.
- Side, probability, projection, grade, price, EV, stake, and tracking changes: 0.
- Provider budget change: 0.
- Writer/lease count change: 0.
- Stored evidence or prediction rewrites: none.

The schedule-date choice affects only how the existing exact provider game ID is looked up for a completed prior result. It restores the intended writer after a provider schedule correction; it does not change model or grade math.

## Pre-deployment result

- Current provider window: September 10–14 Eastern, with 131 Division I games (1 Thursday, 5 Friday, 125 Saturday) and 86 FBS-involved games.
- Repaired no-write writer replay: 111 model-covered opening payloads, 169 evaluated markets, 164 explicit held markets, zero capture failures, and no writes.
- Grade distribution from current natural inputs: 6 Best Angles, 46 Leans, 77 Watchlists, and 40 No Plays. These are input-driven current-board results, not target quotas.
- The existing weekly board renderer groups football games by Eastern game date and exposes the full model-covered Division I board behind its scope control.
- Focused CFB production/reader tests, TypeScript, affected-file lint, the 201-test Daily Edge experience suite, `npm run verify:model-change`, `npm run verify`, and `npm run build` passed.

## Required verification

- Focused CFB production and member-reader regressions.
- TypeScript, lint, `npm run verify:model-change`, full verification, production build.
- Latest-main integration safety and protected PR checks.
- Natural production writer success under the shared lease, fresh compact snapshot, coherent release identifiers and counts, empty released lease, and responsive authenticated CFB member board.
