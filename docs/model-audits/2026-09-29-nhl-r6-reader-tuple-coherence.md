# NHL r6 reader tuple coherence — 2026-09-29

## Finding

The r6 writer correctly created 15 active-release prediction records for the
five-game September 29 slate. The immediately regenerated member snapshot still
showed r5 scores because the reader reused stored tuples only after lock and
recomputed every unlocked card without the writer's persisted opponent-adjusted
state. That recomputation correctly entered the r5 safety fallback, but it made
the unlocked member card disagree with the authoritative r6 records.

## Repair

Reader release `nhl_daily_edge_reader_2026_09_29_r2_writer_tuple_coherence`
uses the active-release writer-owned model output and feature snapshot for both
unlocked and locked games. Current prices and market context remain live reads.
All sibling market records for a game must contain an identical model/feature
tuple; an inconsistent set is rejected rather than arbitrarily selecting one.

This adds no writer, provider request, model equation, probability, score,
grade, market, lock change, member copy, label, or layout. It makes the reader
display the already-reviewed r6 tuple. Existing locked records remain immutable.

## Verification and rollback

The focused NHL regression must prove active-release tuple reuse, sibling tuple
coherence, exact-line price selection, and locked preservation. Production must
show five member games whose displayed decimal score, Moneyline, Total, puck
line, probabilities, and grades match the 15 r6 records. Roll back the reader
release if a game disappears, a sibling tuple conflicts, current prices are
lost, or the stored member snapshot differs from the r6 writer tuple.
