# NFL Player Props independent calibration: Rushing Attempts predeclaration

Date: 2026-10-08  
Status: predeclared before candidate scoring  
Scope: Rushing Attempts only

## Failure this test addresses

The first independent-first weight tournament held the active settlement-aligned point head and
2023-2024 empirical residual distribution fixed. The independent probability was more accurate
directionally than the target-book-excluded market benchmark, but it was biased toward the Under
and became overconfident as its posterior weight increased. No predeclared weight at or above 65%
independent passed selection.

This second tournament tests whether a chronology-safe, price-blind calibration of the independent
signal fixes that probability failure. It does not retrain or choose the point projection using a
line or price. The offered line is only the threshold at which the already-frozen distribution is
queried; sportsbook prices and consensus probabilities are forbidden from every independent
candidate.

## Frozen inputs and chronology

- Point head: active settlement-aligned Rushing Attempts portable model and its exact artifact
  checksum.
- Eligible outcomes: official 2025 regular-season participants at QB/RB/FB.
- Quote identity: exact player, event, market, line, and same-book Over/Under pair; the executable
  target book remains excluded from the consensus benchmark.
- Calibration fit: games dated through 2025-09-30.
- Candidate selection: games dated 2025-10-01 through 2025-10-31.
- Locked confirmation: games dated 2025-11-01 or later.
- The test remains read-only and may not alter a production artifact, database row, grade, stake,
  or locked member snapshot.

## Candidate families

All families use only the independent point projection, the offered threshold, position, and
settled outcome:

1. Active empirical residual distribution (reference independent probability).
2. Regularized Platt calibration of the active independent probability.
3. Regularized logistic residual calibration using `projection - line`.
4. The same residual calibration with QB versus RB/FB position interaction, only if both fit groups
   have adequate support.

Each selected independent probability is then tested at 65%, 80%, and 100% of posterior log odds.
The current production posterior (20% independent / 80% target-excluded market) is the benchmark.
The pure target-excluded market and 35%/50% independent blends are diagnostics only.

## Selection and acceptance gates

- At least 75 non-push rows are required in each of fit, selection, and confirmation.
- Candidate selection is frozen solely by October Brier score among candidates that beat the active
  independent probability in both October Brier and log loss.
- A shippable posterior must use at least 65% independent log odds and beat the current 20% posterior
  in both Brier and log loss in October and the locked confirmation window.
- Confirmation direction accuracy may not decline, and calibration gap may be at most 0.005 worse.
- Report game-clustered uncertainty for the confirmation Brier delta.
- Before release, replay the exact Week 4 board and report board counts, grade transitions,
  actionable promotions and demotions, nonpositive-EV actionables, and settled units.
- Every actionable demotion must have a tested promotion rule. A smaller board alone is a veto.
- Locked writer immutability and locked reader precedence must remain proven.

If no candidate passes, production remains unchanged and the next model hypothesis must address the
point/role architecture rather than relaxing these gates.
