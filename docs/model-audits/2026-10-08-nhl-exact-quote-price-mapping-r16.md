# NHL exact-quote price mapping r16

Date: 2026-10-08

Starting production base: `5d3c2731ce02a69a1101df0968384293f679625d`

## Scope

This is a lock-preserving NHL price-mapping correctness release. It changes the
NHL Moneyline, Total, and puck-line quote-selection boundary shared by the sole
prediction writer and member reader. It does not change model coefficients,
projected scores, probabilities, prediction sides, grade thresholds, stakes,
provider cadence, leases, schedules, member copy, labels, layout, or tracking
definitions.

## Production defect

The writer and reader had independent best-price implementations. The writer
stored a price, side, and line but not the selected sportsbook, while the reader
later rebuilt the sportsbook and price context from the mutable live line table.
The writer also lacked the reader's median outlier guard. This allowed two forms
of incoherence:

1. an isolated off-market but internally paired quote could become the grading
   input; and
2. after a game locked, a later odds refresh could make the member card display
   a different sportsbook/price context beside the immutable locked grade.

A read-only October 8 production audit reproduced the second issue across
multiple locked rows. Examples included VAN-CAR puck line stored at `-120` but
the mutable reader selecting `-130`, CHI-NYI Moneyline stored at `-167` but the
live table selecting `-160`, and UTA-BOS Total stored at `+122` but the live table
selecting `+110`. No locked record was edited.

## Repair

- `selectNhlBestPriceQuote` is now the sole quote selector used by both writer
  and reader. It canonicalizes complete two-sided exact-line pairs, selects the
  requested side and line, and rejects a quote more than 50 American points from
  the candidate median when at least three books exist.
- The selected sportsbook, side, line, American price, and observation time move
  together as one tuple.
- Future r16 snapshots persist each market's selected tuple in
  `evaluated_quotes` before lock.
- Reader r12 uses the stored record price/side/line and frozen evaluated quote
  for a locked row. Mutable current lines and opportunities are ineligible.
- Legacy locks remain unchanged. Their frozen line snapshot may identify the
  sportsbook only when exactly one row matches the stored market/side/line/price.
  Ambiguous legacy book identity remains unknown rather than being fabricated.

## Zero-write board replay

The exact October 8 board contained 10 games and 30 official market rows:

- 24 locked rows were preserved and skipped by the r16 writer.
- 6 unlocked rows were regenerated without database writes.
- Unlocked sides, scores, probabilities, grades, and selected prices were
  unchanged for the stored input.
- Promotions: 0.
- Demotions: 0.
- Unlocked actionable markets: 4 before, 4 after.
- Writer errors: 0.

The focused test proves shared exact-quote selection, isolated promotional-price
rejection, stored locked-price precedence, unique legacy frozen-book recovery,
and non-fabrication of ambiguous legacy sportsbook identity. The NHL model suite,
TypeScript, full model-change verifier, integration-safety verifier, and protected
PR checks remain publication gates.

## Rollback

Roll back model/calibration/decision r16 and reader r12 together to the r15/r11
family. Do not rewrite, delete, recompute, relabel, or reinterpret any locked
record during rollback. Roll back if an unlocked row selects a quote without an
exact complete opposing pair, the stored quote tuple disagrees with the written
price/side/line, a locked reader consumes a post-lock live quote, board coverage
falls, or the sole-writer/lease boundary changes.
