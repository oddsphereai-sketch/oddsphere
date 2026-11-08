# CBB tracking guard publication-clock repair

Base: `537d91da91db3a58ad7dd3f05f1a78323f22eee8`.

Postdeployment proof of #1062 found that CBB's 887 tracking records were all
settled, but the operational guard observed zero independent CBB member locks.
`cbbMemberGameStore` deliberately stores `slate_date=null` on per-game member
snapshots. Filtering that nullable relational field silently excluded the source.
The separate full source census had already reconciled 257 published Best/Lean
calls; no CBB prediction, grade or stored evidence was missing or changed.

The SELECT-only guard now bounds per-game member reads by `generated_at`, which
the sole CBB writer stamps at lock publication, with one day of cutoff grace.
It then checks each exact stored start against the canonical Eastern slate date.
No all-history JSON timestamp filter or historical payload rewrite is needed.
The source-clock identifier is
`tracking_cbb_manifest_clock_2026_11_08_r1_publication_metadata`; it is included
in the audit report. The overall published-lock/settlement contract and every
model, calibration, grade, prediction writer, lease and schedule remain exact.
This is operational monitoring coverage, with current-board promotions/demotions
0/0 and no stored prediction/grade writes.

An end-to-end fake-client regression uses the real nullable slate-date storage
shape and proves independent CBB source reconciliation plus the UTC/Eastern
boundary. Reciprocal source coverage refuses to report healthy if real CBB actionables have no independently read lock, and an entirely absent tracked game is detected from its member source. A production SELECT-only shadow must observe all 257 existing CBB
Best/Lean locks, with zero missing source records or settlement errors. Focused
tracking tests, build/types, clean latest-main integration safety, protected PR
and actual live source-count proof are required. #1062 already passed the full
model gate; this patch changes no model inputs or numerical behavior.
