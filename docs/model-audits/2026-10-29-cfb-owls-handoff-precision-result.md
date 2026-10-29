# CFB normalized-PMF publication repair

Base: `2a8e4d4322f243f6fdec7df690904c906bffbe46`.

The complete-release guard is unchanged. It correctly refused to make the
partial r55 evidence wave authoritative after Baylor/UCF failed coherence.
The r56 repair instead fixes the underlying floating-point discrepancy between
the winner-PMF bisection's raw-mass complement and the validator's unit-mass
complement. The probability contract now agrees at the existing 1e-9 boundary.
No policy threshold, reader evidence/weight, total distribution or trained model
artifact changes. New calibration/coherence/decision releases identify the repair.

Regression tests prove the exact arithmetic failure at
`p=0.5000000004999998, mass=0.9999999999999996`; both home/away repairs with
slightly sub-/super-unit floating sums pass the real downstream validator.
Every total-bucket mass and the expected total remain unchanged to numerical
tolerance. Already coherent forecasts retain exact reference/value identity.
Writer and reader tests preserve exact r55/r42/r28 and r54/r41/r27 locked
payloads, without replacement or relabeling.

At 22:19 UTC the sole-writer zero-write rehearsal proposed all 95 unlocked rows
with ZERO capture failures (the previous run proposed 94 and failed Baylor/UCF).
Owls grading inputs covered 69 games, eleven distinct books, maximum eleven
books/game and 7,115 bytes added evidence/game. On the same repaired PMFs the
existing-vs-supplemental-price comparison preserved all 156 evaluated markets:
18 Best Angle, 24 Lean, 99 Watchlist, 15 No Play, 129 Held before and after;
zero promotions/demotions. These counts compare ingestion lanes on identical
current inputs, not different historical model eras or a profitability test.
Local Playbook credentials are absent (reported 401); production had verified
both Playbook products healthy on the previous live run.

Passed focused CFB production suite, full model-change verification, TypeScript
no-emit and changed-file lint (three pre-existing unused-variable warnings).
The optional local Market Brain PostgreSQL proof is skipped without its URL;
the preceding production PR's actual CI PostgreSQL proof passed. No Market Brain
or new shadow writer is included here. Existing `prediction_pipeline:cfb` lease,
provider-call count and exact immutable records remain unchanged.

Preceding ingestion live proof: writer r142 acquired the normal lease, stored
94 rows and eleven current JMU/Troy books with all provider errors null.
All 796 prior T-60 row hashes remained byte-identical (digest
`403b064de17f8094b901a6955b7fa6b50bde7f78deb46cfc6da4b5033844764e`).
That run's refreshed envelope did NOT mean current member evidence was published:
its source remained old. Require source timestamp AND game-price timestamp
advancement, zero capture failures and complete new release selection after
this repair. Never call a new envelope around a fallback board a successful cutover.

Rollback: previous main/r142, retaining all existing and future immutable locks.
No direct database rewriting, partial-slate suppression or guard bypass is allowed.
