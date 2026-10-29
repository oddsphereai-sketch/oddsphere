# CFB Owls grading-price ingestion repair

Base: `86c99a4303af9bc5e5dcd0ecec9fecb2315a7743`.

Owner requested ingestion-first production repair on October 29. This supersedes
the unmerged policy experiment in draft PR #877; none of that relaxation ships.

Scope: future-unlocked CFB moneyline, spread, total exact-price decisions through
the sole forward-evidence writer and its existing `prediction_pipeline:cfb`
lease. Reuse the existing two Owls slate requests. Capture additional conventional
sportsbook pairs separately from forecast/reader price inputs. Preserve existing
evaluated markets; only held markets may use the supplemental price lane. Keep
the current two-other-books-at-identical-line requirement, EV/edge thresholds,
injury caps, health holds, stake rules, and six execution books unchanged.

Champion: model r26, distribution r24, probability r28, calibration r27,
policy r28, decision r54, tuple r41, writer r141, collector r65,
fixture r95, snapshot/reader r55/r40. Forecast/model/reader releases and grade
policy stay unchanged. Advance calibration to r28, decision/tuple to r55/r42,
writer/collector to r142/r66, provider to r2, fixture/snapshot/reader to
r96/r56/r41 with explicit immutable r54 compatibility.

No stored locked payload may change. Retain legacy calibration, exact tuple,
pick, evidence, grade and price first in writer and reader compatibility paths.

Validation: exact canonical teams, sport, kickoff; complete opposing pairs;
fresh provider timestamps (one hour max, no future/in-play observations); explicit
conventional-book allowlist; no exchange/unknown book or duplicate-book votes;
primary provider precedence at each market. Same-input zero-write full-writer
comparison reports all promotions/demotions, board counts and forecast equality.
Focused ingestion/decision/legacy-lock tests, full model verification, typecheck,
lint, fresh-base integration safety and protected PR required before live release.

This is an owner-requested input wiring correction, not a learned promotion or
threshold-tuning experiment. No retrospective outcome fitting or new grading
rule is authorized. If ingestion leaves exact-line coverage insufficient, report
that limitation rather than bypassing the existing policy. Unexpected demotions,
forecast changes, mixed releases or lock changes block publication.

Rollback: previous main and r141 writer; preserve all published new/old locks.
Verify production commit, writer release/lease, current snapshot, prices and
next scheduled refresh after merge. Do not claim deployment from a preview.
