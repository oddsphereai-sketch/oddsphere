# NFL pressure-release transition continuity hotfix

Date: 2026-09-27

Scope: NFL Daily Edge compact member fixture/snapshot and the existing sole
forward writer. Forecast math, probabilities, sides, grades, stakes, provider
requests, schedules, leases, member copy, labels, and layouts are unchanged.

## Production finding

The first natural r43 production refresh successfully wrote the six remaining
unlocked Week 3 games under member r21, but the compact member fixture failed
closed at `7/16` coverage. The transition allowlist still named marginal-score
r19 as its immediate predecessor even though nine immutable Sunday T-60 games
were locked under current-season r20. The Thursday game was correctly locked
under opening-direction r18. Because the reader admitted only current r21 plus
the r18 fallback, it saw six unlocked games and one lock, refused the partial
fixture, preserved the last complete r20 member snapshot, and skipped the
tracking handoff.

## Repair

The fixture now recognizes current-season r20 / decision r22 as the immediate
preceding authority and retains opening-direction r18 / decision r21 as the
older bounded fallback. A preceding row crosses the transition only when the
stored tuple independently proves an on-time immutable T-60 lock with all three
markets; unlocked preceding-release rows remain rejected.

The compact snapshot advances to r23 and explicitly maps both the failed r22
pressure snapshot contract and the last complete r21 current-season contract.
The fixture advances to r31 and the sole writer to r44 so production performs
one release refresh through the existing `prediction_pipeline:nfl` lease.

## Exact production-data proof

The patched reader was run read-only against the release-mixed production
evidence written before this hotfix. It reconstructs exactly 16 games / 48
markets: ten immutable locked games and six current r21 unlocked games. Current
odds, operational openings, Playbook splits, and injury context cover all 16;
tracking eligibility reports exactly the ten locked games. No stored prediction
or lock is rewritten.

Required focused suites, model-change verification, TypeScript, targeted lint,
production build, latest-main integration safety, protected PR checks, and live
r44 writer/r31 fixture/r23 snapshot proof remain release gates. Roll back future
unlocked publication on any partial coverage, unlocked predecessor admission,
mixed unlocked authority, snapshot mismatch, lease overlap, tracking omission,
or member/database disagreement while preserving all immutable evidence.
