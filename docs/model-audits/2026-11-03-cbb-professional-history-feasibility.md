# CBB professional history feasibility probe

Starting remote main: `0ade51e2c4b9d20d1d8d5384a45b642073d04d40`.
Dedicated branch: `codex/cbb-full-market-reader-20261103`.

This is an offline source feasibility check, not a model, grade, stake, writer,
reader or cron change. Keep all locked records and production snapshots intact.
No publication or forecast authority follows from finding historical prices.

The live CBB R5 score uses qualified movement from an earlier quote but leaves
the professional starting level unresolved. R7 can produce model-value Leans
without positive professional exact-target value; on the November 3 17:47 UTC
board, all 11 Leans have this property. The owner requires a single coherent
market-conditioned score, probability, price and grade process, including
nuanced path/flow interpretation and both promotions and demotions.

The existing 105-game November 2 current-professional fit is all development:
71 games fit location and 34 fit scale, with no untouched full-model test. The
older 1,070-game January–March archive has point-in-time independent shadow
forecasts from an earlier fit-through-2024 release, whereas the live independent
artifact includes the 2025 season. Therefore it cannot directly backtest the
current R3 release. A retail-opening stack from that archive worsened Spread
log loss and cannot be relabeled as a professional-current model.

Owls `/api/v1/history/coverage` reports NCAAB games from January 28, 2026;
one February event has genuine Pinnacle Spread/Total rows. Official Owls docs
state that many pre-September 16 stored `recordedAt` timestamps are Eastern
wall time mislabeled with `Z`, and `recordedAtUtc` is null for Pinnacle before
April 10. The probe must preserve the raw timestamp, any inferred Eastern-to-UTC
conversion and the missing native UTC flag separately. It must never claim
exact historical decision availability solely from the mislabeled `Z` field.

Probe exactly 20 archived fixtures: from the 1,070-row immutable archive
`/private/tmp/oddsphere-cbb-stthomas-recovery-20261102/historical-2025-candidate-rows.json`,
split by game UTC date before versus on/after February 28, 2026. In each
stratum sort by SHA256 UTF-8
`cbb-pro-source-coverage-2026-11-03 + "\n" + orientationEventId`; select the
first ten. This rule does not inspect results, market prices or model errors.
For each selected game, request only Pinnacle snapshots within the stored-clock
window corresponding to 6h10m–6h before the official UTC tip. Limit each
response to 150 rows and one request per game. Stop after 20 requests or 500
reported monthly allowance units, whichever comes first. No retries or page
top-ups. Record response status, remaining allowance, raw book/market/side,
line, price, recordedAt and recordedAtUtc, and whether a coherent same-timestamp
Spread and Total pair exists. Preserve missingness and all exclusions. Do not
fetch splits, fit coefficients, infer scores, grade decisions, call the full
slate writer, or touch any production row.

An independently reviewed model candidate would still need chronological
training, calibration and untouched later-game evaluation at comparable
source/horizon/independent-release conditions, including margin/Total dependence,
executability, adverse and supportive path evidence, board counts and locked
writer/reader precedence under `docs/model-change-safety.md`.
