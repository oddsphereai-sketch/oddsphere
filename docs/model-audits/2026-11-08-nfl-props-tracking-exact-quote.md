# Exact NFL tracking quote evidence

Base: `7ee492a851bf8c44f399cd2ba80950c61f090b73`.

A read-only production audit found that the official tracking writer's map used
only game/player/market/line/side to recover a decision. Multiple books share
that key. A tracking candidate could retain its correct top-level price but
attach another book's final decision as snapshot_json.decision.

Tracking R43 carries each tracking row together with its exact original source
decision through one authoritative builder. Writer R76 identifies that binding
repair. Tracking eligibility, row ordering, keys, duplicate-insert precedence,
top-level prices/probabilities/EV, grades, identities and every forecast remain
unchanged. Same-source board impact is zero promotions, zero demotions and no
changed projection, probability or stake. R16 review batching, selection R1,
member R57, lifecycle R39, source decision R8 and all native model/calibration
identifiers remain exact. No new reader, writer, provider call, timer or review.

Existing locked tracking records, including inconsistent legacy evidence, remain
exact under their original capture release. This change does not repair,
replace, reinterpret or relabel those records. A historical correction would
require the owner's explicit approval and preserved original evidence. No
locked member snapshot is changed or reconstructed. ON CONFLICT DO NOTHING
continues to protect previously stored official records.

Offline tests pass multiple books with the same tracking identity through the
actual writer and assert that every candidate's exact source quote, price,
probability, EV and player ID agree. They also prove complete source immutability
and unchanged stored legacy/missing-identity/inconsistent-quote records. Existing
T-60 lifecycle, reader, tracking and PostgreSQL capacity/duplicate tests remain
required, alongside the full model gate, lint/TypeScript/build, latest-main
integration, protected PR and natural live tracking proof. No paid AI test or
manual cron. Do not equate a heartbeat or member publication with a tracking
write; check the actual saved records and release.
