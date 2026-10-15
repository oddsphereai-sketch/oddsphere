# NFL exact-provider independent score r7 — frozen predeclaration

Date: 2026-10-15

Status: research-only exact-input-parity test; no production writes.

## Correction to r5 scope

BALLDONTLIE exposes play type, down, distance, yardage, team, text, score and
red-zone team statistics, but it does not expose nflfastR's exact EPA-derived
`success` field. Therefore r5 is not eligible for production parity as written.

r7 repeats the already-frozen r5 tournament with `success` removed. The exact
feature metrics are explosive-play rate, sack rate, turnover rate, play count,
red-zone touchdown rate, no-huddle rate, and points. All context, state update,
split, estimators, 96-tree forest size, selection order, score construction,
and leakage exclusions remain unchanged. No substitute success definition is
allowed.

As before, no market information enters the independent model and no scalar
market weight is allowed. The market reader is evaluated separately after the
independent score is complete.

The r5 gates and evidence boundaries remain unchanged. If r7 materially loses
the predictive side gain, it is rejected and an explicit expected-points model
must be predeclared and implemented identically in historical and live feature
generation before EPA/success can return.
