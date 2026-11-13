# CBB lock-first tracking and November 12 recovery

Starting production base: `e0b139d80de8c2341f33e21a2f0c45ef88575f1d`.
Scope: the existing CBB daily refresh, member publisher, immutable tracking
serializer and owner-approved November 12 historical recovery. No other sport,
statistical model, calibration, numerical tolerance, quote selection, grade,
stake, provider budget, timer or prediction writer is changed.

## Confirmed failure

The November 12 canonical schedule has29 finals,24 inside the released model
scope. Only five games /15 markets reached tracking. All15 were graded; the
grader did not lose19 already stored games. The last complete publication was
as of22:47:44Z, with actual per-game captures22:51:32–38Z. Its remaining19 games
never acquired a lock. These captures precede each game's own T-60 cutoff.

Starting23:02Z, complete rolling forecast work failed with
`rectangle integration evaluation budget exhausted`. Later cycles also reported
`negative Gaussian interval from numerical cancellation`. Both refusals are
preserved; no numerical approximation is substituted. The full computation
preceded every lock, so a future-game failure prevented the evening lock writes.

A subsequent provider correction reused event10883194: the stored unlocked
forecast was Towson at Morgan State (schools152/203), while the canonical event
became Morgan State at Loyola Maryland (203/272). The existing exact school
guard correctly rejected this migration, but its unisolated exception then
aborted unrelated games. The West Florida/Argonauts spelling differences remain
covered by the existing verified school732 identity helper and are not this
new mismatch.

## Prospective repair

RuntimeR3 executes bounded lock sweepR1 first, inside the unchanged
`prediction_pipeline:cbb` lease and existing15-minute job. It reads at most300
due canonical fixtures and their existing stored decisions, then calls the
same member freezer and tracking serializer. No provider, source refresh,
training or inference is required. It verifies the actual write clock is
inside T-60 and strictly before kickoff; a qualifying original capture must
precede the cutoff. Each fixture failure is reported without preventing another
game's lock. Existing locked payloads return unchanged and repeat serialization
is idempotent.

PublisherR56 isolates only typed `CbbScoreLawNumericalError` evaluation failures;
a prior published forecast is retained exactly when present. Other unknown
runtime errors and whole-source failures still fail closed. No new model is
computed for the failed fixture. An unlocked changed-school event is quarantined
from model evaluation while its corrected canonical matchup remains visible in
the existing schedule-only presentation; the original source remains unchanged.
Locked records retain original identity and reader precedence. There is no
generic alias, matchup migration, forced prediction or new member layout.

On the same valid fixture/input cohort there are zero prediction, probability,
price, grade or stake changes and zero actionable promotions/demotions. The
changed event is a different matchup, so its prior forecast is not performance
evidence for the corrected event. This is an operational availability repair,
not evidence of improved forecast accuracy or a new grade policy.

## Explicit historical approval

On November13 the owner reviewed the19-game comparison and replied:
“Add all 19 games; preserve originals.” The manifest
`scripts/fixtures/cbb-missed-lock-recovery-20261112.json` pins every original
game ID, complete-payload SHA256, capture time and scheduled kickoff.

The approved append-only scope is55 absent predictions:19 Moneylines (12–7),
18 Spreads (8–10),18 Totals (9–9), including10 original Leans. The West Florida
game had only a stored winner forecast and cannot receive invented Spread or
Total bets. All original19 member payloads remain unchanged with `lockedAt:null`;
all15 original tracking records remain unchanged. The exact original model,
calibration, side, probability, grade and quote fields are copied, not recomputed.

RecoveryR1 records the actual recovery timestamp in the new record's `locked_at`,
the original null lock/capture and scheduled cutoff in provenance, and explicitly
sets `on_time_t60_lock:false`. The virtual serialization envelope is not stored
as a replacement member snapshot. The source evidence hash continues to identify
the exact original; the distinct virtual envelope hash is recorded separately.
Only the existing serializer builds records, only the existing pure grader
determines results, and the operator must acquire the same sport pipeline lease.
The operator defaults to SELECT-only and refuses a changed manifest/source,
late original capture, existing different historical row, missing final,
unexpected market count or unexpected result comparison. Apply inserts only
missing predictions and grades; duplicates are never replaced. Re-running uses
the existing recovery time and cannot create duplicate markets.

## Validation and release gates

Focused tests exercise the actual freezer/serializer, exact original decisions
and clocks, one bad game followed by a good game, repeat immutability, a write
crossing kickoff, missing pre-cutoff evidence, DB failure/cap refusal, numerical
LKG retention, genuine source identity migration quarantine and explicit
historical recovery provenance/reader precedence. The production-input recovery
dry run verified all55 original contracts and10 Leans with no writes, fits,
provider requests or outcome-driven selection.

Required before publication: full unchanged model-change gate, focused CBB
suites, TypeScript, changed-file lint, production build, clean committed
fresh-main integration, protected PR checks and exact remote/local tree parity.
After publication verify the deployed commit, natural CBB refresh, actual due
locks when present, complete live board/source coverage, historical55-row
recovery/grading, original19 hashes and15 records, and actual member tracking.
This document does not declare those outstanding deployment checks complete.

Rollback restores the prior operational publisher/runtime for future work only.
Never erase, relabel or recompute an original lock or approved recovered record.
No forward hit-rate, ROI or calibration improvement is claimed.
