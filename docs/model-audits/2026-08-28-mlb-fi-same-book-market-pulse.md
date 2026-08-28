# MLB first-inning same-book Market Pulse repair

## Scope

Reader-only presentation repair. MLB probabilities, projections, picks, exact-price grades,
prices, stakes, locks, tracking rows, providers, writer ownership, and model releases are
unchanged.

## Production defect

The signed-in BOS at NYY first-inning reader displayed two valid but different sportsbook
histories in one visual claim:

- the evaluated BetRivers NRFI quote moved from -136 to -127, which is resistance;
- the visible Hard Rock two-sided FI board moved NRFI from -135 to -150, which is support.

The Market Pulse headline was derived from the generic evaluated-price trail while the panel
directly beneath it rendered the Hard Rock board. Members therefore saw `-135 -> -150` under a
resistance headline even though the shared American-odds classifier correctly treats that move
as support.

## Repair

For a directional MLB NRFI/YRFI read, Market Pulse now uses the displayed two-sided FI board as
its movement authority. The selected-side opening, previous, current, line, and sportsbook are
kept as one tuple. The reader fails closed when that named book lacks a same-book opening.
`fiBoardHistorySide` no longer borrows an opening from another sportsbook when the board names a
target book.

The exact evaluated sportsbook and price remain unchanged in Quick Read and grading. This repair
only prevents a different sportsbook's movement from labeling the visible FI board.

## Regression contract

- NRFI -135 to -150 is support.
- NRFI -120 to -114 is resistance.
- A named FI board without a same-book opening makes no directional movement claim.
- The shared presentation release is
  `daily_edge_member_presentation_2026_08_28_r14_fi_same_book_pulse`.

Rollback is the r13 presentation behavior.
