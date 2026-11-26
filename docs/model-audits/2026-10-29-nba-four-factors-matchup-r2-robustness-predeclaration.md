# NBA Four Factors matchup r2 robustness predeclaration

Date: 2026-10-29

Status: offline audit only. No production, member, writer, database, grade,
stake, lock, tracking, reader, board, or persisted-shadow authority.

## Purpose

Repair two independently identified reproducibility defects in the predeclared
NBA Four Factors r2 experiment without changing its continuous features,
chronology, baseline, evidence partitions, practical gates, or interpretation
boundary.

The original r2 result remains preserved. It cannot authorize a model change.

## Frozen repair

1. Fit the alpha-1000 baseline-plus-eight-feature candidate only. The failed
   alpha-10000 sensitivity is retired because it changes regularization for all
   incumbent features and is not a clean feature-family attribution.
2. Add exactly the eight declared continuous blended matchup features. Do not
   add missing-indicator columns for those features. Existing incumbent missing
   indicators remain unchanged.
3. Replace iid game resampling with a paired season-by-calendar-week block
   bootstrap. Sample whole blocks with replacement, retaining every paired
   candidate-minus-baseline game difference in a selected block. Use 2,000
   draws and seed 20261029.

Everything else remains frozen from
`2026-10-29-nba-four-factors-matchup-r2-predeclaration.md`, including:

- base commit, feature-ledger SHA-256, artifact and feature releases;
- 2023-24 selection only;
- no 2025 outcome scoring unless every overall selection gate passes;
- direct alpha-1000 refit inside each chronological fold;
- deterministic 15-game/prior blend;
- frozen incumbent margin cohorts;
- the `-0.10` team-score MAE practical threshold and every noninferiority,
  calibration, slope, tail, interval, cohort, and per-season gate.

## Added maturity diagnostics

Report results by the pregame minimum of home and away current-season games:
0-4, 5-14, and 15+. These cohorts are diagnostic only and cannot rescue an
overall failure.

If the candidate again misses the `-0.10` overall team-score threshold, this
disagreement-edge formulation is retired. A later experiment must use a
separately predeclared basketball mechanism; it may not search alternative
blends, penalties, thresholds, or subsets of the same formulation.
