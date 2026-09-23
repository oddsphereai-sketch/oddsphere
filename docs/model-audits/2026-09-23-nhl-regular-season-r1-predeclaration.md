# NHL regular-season r1 predeclaration — 2026-09-23

## Scope and boundary

- Sport: NHL only.
- Markets: moneyline, total, and puck line (`market="spread"`).
- Public start: 2026-09-29, NHL game type `02` only.
- Permanently excluded: game type `01` preseason, including the ten September 22
  games mistakenly written by the retired Finals model.
- Retired champion: `nhl_v0_2026_finals`.
- Candidate releases: `nhl_regular_2026_r1`,
  `nhl_regular_calibration_2026_r1`, and
  `nhl_regular_decision_2026_r1`.
- Refresh release: `nhl_daily_refresh_schedule_2026_09_23_r2_regular_only`.

Old rows remain immutable internal evidence. The tracking reader admits only a
locked type-02 row with the exact r1 model and calibration identifiers on or after
September 29. That resets the member-facing NHL record without deleting audit data.

## Authoritative paths

`writeNhlPredictionRecords` remains the sole NHL prediction-record implementation.
Its existing daily and tracking-refresh callers share the sport-scoped
`prediction_pipeline:nhl` lease and locked-row preservation. No new writer or timer
is introduced. The reader is `buildNhlDailyEdgeAdapted`; coherent DB snapshots are
republished only after the normal seed → odds → splits/stats → prediction sequence.

## Data hierarchy and load budget

- Schedule/finals: official NHL API.
- Current/prior team metrics: BallDontLie NHL, seven league-level leader reads,
  cached for 30 minutes with completed-prior-season fallback.
- Independent calibrated state: frozen 2026 opening priors from BallDontLie
  2023-2025 regular-season outcomes, then replay of prior settled 2026 type-02 games.
- Advanced team/goalie context: MoneyPuck completed prior regular season.
- Prices: SharpAPI multi-book lines and line history, excluding blocked books.
- Public money/tickets: persisted Playbook-preferred observations with SharpAPI
  fallback. Refresh failure never deletes the previous complete observation.

Provider work is slate- or league-scoped, not card- or user-scoped. The reader
performs bounded DB reads; the 15-minute split job republishes the existing coherent
snapshot and uses the same sport lease.

## Evaluation design and promotion rule

The frozen cache contains 3,936 regular-season games (1,312 per season) and 5,362
opening-odds rows. Outcomes update a team only after its forecast. The design uses
2023 as warmup, 2024 for independent parameter selection, the first 783 priced 2025
games for market-weight selection, and the last 336 priced 2025 games as untouched
holdout.

Puck line is a new official category, so the active regular-season before-board is
zero. No active regular-season recommendation is demoted. The candidate must create
all three predictions for every priced regular game. On the historical holdout, the
same eligibility rules produce 296 moneyline, 208 total, and 317 puck-line
actionables out of 336 games; that is 821 actionables versus zero on the retired
regular-season board, with zero active-board demotions. Those counts are evidence,
not quotas.

## Hold/rollback gates

Hold the release on preseason leakage, missing release stamps, mixed releases within
a slate, incomplete puck-line writes, provider calls per card, an empty board caused
by one provider failure, a current-price actionable with no price, or any failed
focused/model-safety/build/integration check. Rollback target is the last coherent
NHL reader snapshot plus the retired Finals writer disabled for public tracking; no
preseason or settled row may be rewritten.
