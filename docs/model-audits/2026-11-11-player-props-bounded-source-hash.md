# NBA player-prop source-hash CPU repair — November 11

The first ordinary R35 rescue on the protected deployment reached its unchanged
540-second route limit before any new paid review was claimed. Its request began
at 21:51:19 UTC, obtained the NBA sport lease at 21:53:45, and emitted actual
source callbacks before timeout at 22:00:19. That proves a runtime failure, not
an AI provider failure. The saved audit map keeps the last callback per game;
its timestamps must not all be called the first pass. Original closed jobs and
locked forecasts are unchanged.

Inspection found the exact full source digest inside the qualified-row loop of
`nbaLockAuthority.capture`. The source has already been cloned and remains local
through the synchronous capture. Hoisting that digest to one local value gives
the exact same sourcePacketHash to every proof. No global/weak cache is used;
subsequent calls independently capture any changed source and maintain exact
chronology and ownership seals.

A private offline benchmark of the actual archived 6.98 MB source with synthetic
native row bindings produced 82 qualified proofs in about 5.8 seconds under the
old loop and 0.37 seconds after the local hoist, with byte-identical handoff JSON.
These machine timings are diagnostic evidence, not a promised production latency
or coverage guarantee. Public regression fixtures are synthetic; no player export
or usage receipt is committed.

## Scope and impact

Only the NBA handoff's repeated local serialization/hash work and the NBA writer
release change. Shared generation R35 and NFL/MLB behavior, all numeric laws,
source checks, pricing, grades, callbacks, CAS, tracking, locked-record precedence,
lease, two slots, phases, output caps and budgets remain unchanged. Same-input
promotions/demotions and numerical changes are zero. No schema migration.

## Required validation and live proof

Exact old/new handoff parity, independent-call source mutation, invalid rows,
source and lock safety controls; focused/full model checks; TypeScript, lint and
build; two consecutive fresh three-reviewer full-product rounds; latest-main
integration and strict protected PR; actual production version and ordinary
scheduled source/actor/market/receipt/member publication/lock observations.
No paid tests or manual review/cron are authorized. A deployment or CPU benchmark
alone does not prove complete coverage or correctness of every forecast.
