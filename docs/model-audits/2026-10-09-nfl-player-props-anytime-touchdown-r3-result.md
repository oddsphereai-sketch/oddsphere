# NFL player props Anytime Touchdown independent-model r3 result

Date: 2026-10-09

## Decision

The frozen `market_free_current_opportunity_team_budget` candidate passes every known historical
and Weeks 1-4 acceptance gate. Do not activate it yet. The predeclaration explicitly requires a
new Week 5 forward confirmation, and Week 5 is not complete as of this report. No production
artifact, writer, provider call, prediction, probability, grade, stake, lock, tracking row, member
copy, or layout changes in this result.

This is a qualified candidate, not a shadow-board deployment. Once the completed Week 5 file is
available after nflverse's documented correction window, score the already-frozen model once. If
that slice and the exact-price current-board gates pass, implement the bounded ingestion contract
and release. Do not retune the candidate from Week 5.

## Frozen winner

The winner uses a football-only team touchdown budget and a role-expanded player allocation head.
Its player evidence includes prior rushing and target shares, participation and snaps, depth, and
prior red-zone and goal-line rush/target opportunity. It does not use the evaluated player's
touchdown price, consensus probability, team implied touchdowns, spread, total, score, EPA, or
same-game outcome.

Model shape was selected on 2023, calibration and scorer policy on 2024, and 2025 remained the
chronological holdout. The current-season diagnostic contains 2,522 eligible player-games and 252
scorers across all 64 completed games in Weeks 1-4.

## Gate results

| Metric | Comparison | Frozen candidate | Result |
| --- | ---: | ---: | --- |
| 2025 Brier | 0.073292 market-free incumbent | 0.073248 | pass |
| 2025 log loss | 0.244798 market-free incumbent | 0.243506 | pass |
| 2025 expected-scorer absolute error | 20.26 market-free incumbent | 13.93 | pass |
| 2025 selected-policy F1 | 40.45% market-free incumbent | 40.61% | pass |
| 2026 Brier | 0.076566 released independent | 0.075942 | pass |
| 2026 log loss | 0.258502 released independent | 0.252017 | pass |
| 2026 ROC AUC | 0.826334 released independent | 0.835879 | pass |
| 2026 expected-scorer absolute error | 33.96 released independent | 4.71 | pass |
| 2026 selected-policy F1 | 37.69% released | 38.05% | pass |

Candidate Brier improved in Weeks 1, 3, and 4. Week 2 regressed from 0.069640 to 0.070720, but
the predeclared Weeks 2-4 aggregate improved from 0.076831 to 0.076432, so the frozen three-of-four
and recent-window gates both pass. Candidate selected/correct scorer counts were 79/31, 82/22,
79/27, and 81/29 in Weeks 1-4.

All four position ranking gates pass:

| Position | Released AUC | Candidate AUC | Brier / log-loss check |
| --- | ---: | ---: | --- |
| QB | 0.823492 | 0.840340 | both improve |
| RB/FB | 0.858357 | 0.875398 | both improve |
| WR | 0.799752 | 0.805700 | both improve |
| TE | 0.814480 | 0.816984 | Brier is slightly worse; log loss improves |

No position group regresses both Brier and log loss. The game-clustered candidate-minus-released
Brier delta is -0.000624 with 95% interval [-0.001683, +0.000496]. The log-loss delta is
-0.006486 with interval [-0.010378, -0.002349], entirely favorable and satisfying the frozen
uncertainty gate.

## Audit correction

The first r3 report incorrectly refreshed current opportunity on the released comparison frame as
well as the challenger frame. The challenger predictions were unchanged, but that was not a valid
representation of production. The harness now builds a separate released frame with the exact
frozen current-season opportunity state before portable-artifact scoring. The corrected released
metrics reproduce the r1/r2 report, including Brier 0.076566 and log loss 0.258502. Only the
corrected report is authoritative.

## Remaining release gates

1. Wait for the complete Week 5 PBP asset after the documented correction window and record its
   ETag, byte count, and SHA-256 before reading it.
2. Score the frozen winner on Week 5 without changing features, coefficients, calibration, or
   scorer policy. Reject activation if the forward gate fails.
3. If it passes, implement the predeclared single-fetch, checksum/ETag-pinned, allowlisted-field
   ingestion under the existing NFL writer and `prediction_pipeline:nfl` lease, including source
   attribution and an unchanged-ETag zero-call/no-write path.
4. Run the current exact-price board replay and report promotions, demotions, actionables, coverage,
   and locked-row precedence before assigning release identifiers.
5. Complete focused tests, `npm run verify:model-change`, current-main integration safety,
   protected-PR checks, deployment verification, and a naturally refreshed live snapshot.

## Reproduction

```bash
PYTHONPATH=/private/tmp/oddsphere-nfl-props-pydeps \
  /Users/danielmengel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/operator/audit_nfl_player_props_anytime_td_independent.py \
  --r3-only \
  --output /private/tmp/nfl-player-props-anytime-td-independent-r3.json
```

The script is read-only with respect to production data and artifacts. It makes no provider or
database call.
