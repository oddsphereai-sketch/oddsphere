# CFB lock capture isolation r61 — result

Date: 2026-09-05  
Status: implementation candidate; production acceptance must be appended only after protected deployment

## Implemented behavior

- Per-game synchronous payload construction is isolated. Successful sibling plans proceed to the existing one append; failures are returned as `{providerGameId, stage, error}` and add the `game_capture_failed` health hold.
- Network/provider setup, the sport-scoped prediction-pipeline lease, database reads, the append itself, tracking writes, and snapshot writes remain outside that boundary and retain their prior fail-closed behavior.
- Member lock state now uses response time plus the existing complete immutable T-60 validator. Valid rows render `LOCKED`; pre-kickoff boundary gaps render `LOCKS`; post-kickoff gaps and invalid late attempts render `LOCK MISSED` with no locked timestamp.
- The shared lock component uses an explicit, high-contrast status stamp on every existing board and reader surface. It never presents a missed capture as a successful lock.

## Model and board impact

There are zero formula, PMF, probability, score, side, evaluated-quote, EV, grade, execution, stake, or prediction-record changes. Previously valid immutable locks remain byte-for-byte authoritative. Previously missed boundaries remain missed; they are made visible rather than retroactively reconstructed. The change prevents an unrelated game-specific exception from silently causing the same cross-slate lock loss in a future run.

## Candidate verification

- CFB production contract, including the new sibling-T60 isolation and valid/locking/missed lock-state regressions: passed.
- Daily Edge experience contract: 201/201 passed.
- CFB member-reader reliability contract: passed.
- TypeScript and scoped ESLint: passed.
- Complete `npm run verify:model-change`: passed.
- Next.js 16 webpack production build: 108/108 routes passed.

Integration safety, protected PR checks, deployment, normal leased writer run, compact-snapshot verification, and live-card acceptance remain required before production acceptance.
