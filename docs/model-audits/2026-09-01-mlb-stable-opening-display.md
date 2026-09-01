# MLB stable opening display — 2026-09-01

## Defect

The unlocked Daily Edge reader selected the movement sportsbook by the
richest two-sided history. As additional observations arrived, a different
book could become the richest source. Both displayed trails were internally
same-book, but two snapshots of the same game could consequently show two
different values labeled `Opening`.

## Repair

For display-only Moneyline and Total movement, select the current complete
two-sided sportsbook whose same-line paired history begins earliest. Later
history depth cannot displace that operational opening anchor. Ties use the
existing trusted-book priority and then depth. Every First/Prior/Current stop
still comes from that one named sportsbook; the reader never mixes books.

The recommendation's current/evaluated price remains independent and may
still price-shop normally. Writer movement evidence, prediction, probability,
projection, side, grade, stake, lock, tracking, provider calls, and model
release identifiers are unchanged.

## Validation

The Daily Edge route regression suite proves both the existing no-cross-book
contract and the new invariant that a later, richer book cannot replace the
earlier operational opening book. Production verification must compare two
successive unlocked snapshots of the same MLB game and confirm an unchanged
Opening sportsbook/value while current prices continue updating normally.
