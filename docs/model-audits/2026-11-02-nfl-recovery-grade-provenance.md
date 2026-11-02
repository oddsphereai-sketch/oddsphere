# NFL recovery grading scope and provenance

Starting production base: `69e5499618ac46582f83e3312b200da7a228a67a` (PR923).
Owner scope remains recovery of Eagles–Commanders without altering existing records.

The production recovery successfully appended records533379–533381 and settled
WSH Moneyline as win, PHI+6 as loss and Over40.5 as loss. Its post-apply comparison
caught a provenance-only side effect: the existing whole-slate grader upserted all
36 Sunday grades with source `manual_operator`, changing the source label on the
33 already-settled Sunday rows. No prediction, outcome, grade result, price,
probability, snapshot, note or settlement timestamp changed. The Thursday rows
were untouched. The original `auto_score_ingest` provenance was immediately restored
through the existing grader under `prediction_pipeline:nfl`; the recovered grades
also use automatic exact-provider-score provenance. The recovery receipt retains
explicit owner/operator provenance separately.

The follow-up adds an optional bounded `recordIds` filter to the existing grading
service. Ordinary slate callers omit it and retain identical behavior. Empty scope
is a no-op and invalid/unbounded IDs are rejected. The recovery operator selects
only its exact three persisted record IDs and uses the usual automatic score source.
It cannot read or upsert another game's grade through that call. No second writer,
schedule, model, probability, price, side, grade policy, release reinterpretation,
stake or source evidence is introduced. Recovery r1 / aggregate v19 remain unchanged;
this repairs the one-time operator's scope, not the prediction semantics.

Regression coverage runs the real grading service against three recovered rows plus
a separate settled row with different source, note and timestamp. It proves that only
the three target IDs are written and that the separate row remains exact. Existing
recovery, lock, alternate-line and tracking-refresh suites remain required. Full
model-change verification, TypeScript/build, clean fresh-main integration, protected
PR and exact production tree checks precede publication. After merge, repeat the
operator to prove zero new prediction rows and then compare all36 original records
and grades byte-for-byte against the pre-recovery JSON baseline. Refresh the existing
member snapshot and verify all13 games /39 market rows and alternate-line denominators.
