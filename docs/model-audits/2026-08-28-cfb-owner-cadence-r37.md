# CFB owner cadence r37 audit

Date: 2026-08-28

## Result

The CFB writer now refreshes unlocked games hourly from 48 hours before kickoff through the T-60 boundary. Games more than 48 hours away retain the six-hour interval. The first writer cycle at or after T-60 retains priority and freezes the immutable market-scoped tuple under the existing lock contract.

The member cadence line now states `six-hour beyond 48h · hourly inside 48h · T-60 lock`. There is no 15-minute full-slate collection promise.

## Board impact

This is collection timing only. Against the same stored evidence, model and member outputs are byte-unchanged: zero promotions, zero demotions, zero side changes, zero probability changes, zero exact-price tuple changes, zero stake changes, and zero lock changes. The current 38-game / 114-market board therefore retains its r36 counts until a normal due refresh supplies newer provider evidence.

## Operational boundaries

- One existing CFB writer and the existing `prediction_pipeline:cfb` lease remain authoritative.
- Provider pagination, request cap, strict event identity, sportsbook outlier rejection, and split provenance are unchanged.
- The 15-minute cron heartbeat may notice a due boundary, but it performs no full-slate provider collection until the declared one-hour or six-hour interval is due; T-60 remains event-triggered.
- Rollback is writer r24 plus the prior 24-hour threshold and copy.

## Verification

The final protected-branch and production evidence is recorded in the pull request checks and deployment status. Required local commands: focused CFB production test, Daily Edge experience test, `npm run verify:model-change`, `tsc --noEmit`, webpack build, `git diff --check`, and integration safety against latest `origin/main`.
