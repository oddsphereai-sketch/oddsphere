# NFL exact-provider Total residual r10 — frozen predeclaration

Date: 2026-10-15

Status: research-only final Total-head tournament; no production writes.

## Architecture

The frozen r2 dynamic scoring state supplies the independent Total baseline.
The only candidate correction inputs are the exact-provider r7 feature columns:
explosive rate, sack rate, turnover rate, play count, red-zone touchdown rate,
no-huddle rate, points, and the frozen non-market game context. EPA, success,
CPOE, and all market fields remain excluded.

The residual target is actual Total minus the pregame dynamic-state Total.
Candidate estimators match r7. Frozen correction strengths are 0.25, 0.50,
0.75, and 1.00 with absolute caps of 2, 4, and 6 points. The recipe is selected
on 2023 Total MAE, then refit without recipe changes for expanding 2024 and
2025 confirmation. Completed 2026 and the paid cohort are reported afterward
and cannot select the recipe.

The final independent score uses r7 margin and the selected r10 Total. The
market reader remains separate, categorical, and unweighted. Production still
requires portable and feature parity, board impact, release bumps, tests,
integration safety, owner approval, immutable-lock proof, and live verification.
