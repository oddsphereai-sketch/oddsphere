# CFB prior-results supported-date hotfix — 2026-08-30

## Proven failure

The first natural post-PR-277 writer cycle began at
2026-08-30T18:09:48Z and failed closed before any next-window evidence was
written with `BALLDONTLIE NCAAF results exceeded the pagination safety
budget.` The NCAAF games collection ignores `game_ids[]`; this behavior was
already documented and fixed for score settlement, but the rolling weekly
forecast reader still used the unsupported parameter. The ignored filter
caused an unbounded catalog walk to reach the two-page caller budget.

## Authorized correction

Writer release `cfb_forward_evidence_writer_2026_08_30_r30_dated_prior_results`
uses the existing provider-supported `fetchBalldontlieNcaafResultsForDates`
path. Persisted immutable kickoff dates are grouped into at most three UTC
dates per request plan and exact IDs are bounded to 100 per read. Provider rows
are filtered back to the exact requested ID set before they can enter the
rolling feature state. The hard 1,200 prior-game season budget remains.

This restores the existing leakage-safe rolling feature contract; it does not
change feature formulas, coefficients, the r43 75/25 market/football PMF,
sharp inputs, grade thresholds, stakes, locks, tracking, or any prior row. The
failed r29 run wrote zero evidence, so no mixed or partial wave requires repair.

## Verification

The focused weekly test freezes exact persisted-date/ID planning and rejects
any return to the unsupported exact-ID games call. Existing provider tests
prove the dated reader filters returned catalog rows to the requested IDs.
The full model-change suite, TypeScript, lint, build, integration safety,
protected PR, deployment, and a subsequent natural writer cycle must pass.
Rollback is writer r29; append-only evidence is never deleted or rewritten.
