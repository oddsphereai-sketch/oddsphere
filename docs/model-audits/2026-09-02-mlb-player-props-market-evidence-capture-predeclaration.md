# MLB Player Props Market Evidence Capture Predeclaration

Date: 2026-09-02
Base: `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e`
Capture release: `mlb_props_market_evidence_capture_2026_09_02_r1`

## Scope

This is additive forward evidence capture only. MLB props r38 remains the
authoritative behavior release. The candidate cannot change a posterior,
side, probability, projection, grade, promotion/demotion, exact evaluated
price, stake, lock, tracking tuple, source row, provider call, query, database
write, cron, lease, or member-facing decision value. It adds no table,
provider, endpoint, writer, or refresh path and does not edit the shared model
release registry.

The sole existing `refreshMlbPropsBoard` writer already owns the complete
current and opening prop odds in memory. It normalizes that existing evidence
into one compact object per game/player/market/line identity. All book-specific
Over/Under rows reference the one identity by a deterministic 16-hex ID; the
book array is never copied onto either side row.

## Frozen schema and bounds

Schema `mlbpme1` records:

- a short market enum and at most eight fresh complete books per identity;
- short provider and sharp/retail/unknown source classes;
- exact current observation/fetch time, provider last-change time and skew;
- same-book opening time, line and side prices, including cross-line movement;
- exact verified prop splits only when source, timestamp, tickets and money are
  all present and fresh, with missing splits explicitly neutral;
- complete/incomplete/stale breadth, minimum evaluated-book-excluded comparator
  breadth, opening breadth and split breadth with truthful reason codes;
- incumbent all-book market/movement/related/split inputs, independent and
  published projections, independent/final probabilities, and the existing
  model/shrinkage coefficient.

The evaluated sportsbook remains on each unchanged row and therefore can be
excluded from its referenced identity's alternatives; it does not validate
itself. Book retention is source-stratified. Identity retention is deterministic
hash order within category and category round-robin, never first-N input order.
Canonical capture targets 983,040 added bytes and must remain strictly below
the 1,048,576-byte hard cap. Each stored member payload targets 245,760 added
bytes and must remain strictly below the 262,144-byte hard cap. Locked rows and
their exact prior evidence tuples have priority; a cap may omit only unlocked
additive references.

This capture does not predeclare a replacement blend. A later behavior
candidate must interpret the whole contextual story first—including the
independent player/role model, source class and breadth, target-excluded
agreement, timing and same-book trajectory, resistance/RLM/buyback or
overextension, verified public-versus-Circa contradiction, starter/lineup and
injury context, and model uncertainty. It must stamp the interpreted state
separately from posterior and grade effects, decide confirm/attenuate/reverse,
then rebuild one coherent side/probability/natural-precision projection before
exact-price EV and grading. A universal fixed market percentage is explicitly
out of scope.

## Measured pre-patch topology

The latest r38 canonical snapshot at `2026-09-02T11:47:20.428Z` measured
30,060,742 JSON bytes and 1,486,379 gzip bytes. It contained 5,811 rows, 3,455
complementary identities, six books, and all 17 supported member categories.
The compact 600-row member snapshot measured 1,316,560 bytes and contained 382
identities.

A self-contained tuple prototype projected 2,364 deterministically retained
canonical identities and 1,091 omitted identities at +1,048,247 bytes, only
329 bytes below the hard cap. It retained every category and retained all five
small pitcher categories. The same prototype projected +110,553 bytes on the
compact member snapshot, leaving 151,591 bytes below its hard cap. Because the
canonical margin was too fragile for live variation, the frozen implementation
uses the lower 983,040-byte target while retaining the 1 MiB hard failure bound.

## Required proof

- Canonical and every member-payload value, count and ordering are byte/number
  identical after removing only `marketEvidence` and `marketEvidenceId`.
- Complementary sides and different exact-price books share one identity.
- Target-excluded breadth, source class, timestamps/skew, opening trail,
  incumbent coefficient and independent/final outputs are reproducible.
- Oversized and reversed fixtures remain deterministic, inside both caps, and
  retain every supported category.
- Missing, singleton, incomplete, stale and split-absent states remain truthful
  and neutral.
- Existing provider calls, queries, database-write statements, sole writer,
  sport lease, locks and tracking remain unchanged.
