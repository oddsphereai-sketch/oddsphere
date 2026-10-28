# Preserve observed turns and distinguish sparse quote gaps

Starting production base: `41c52c3ece7000cc820c82c878b02701ab4d89a9`.
Presentation-only repair; no provider calls, model inputs, writers, locks,
prediction/calibration releases, schedules, or persisted evidence change.

The owner identified a misleading rising Circa arc on MIA@ATL, ATL -2.
Read-only production inspection confirmed these exact stored reference prices:

| Eastern time, Oct 28 | Circa ATL -2 | Raw implied probability |
| --- | --- | --- |
| 10:45:38 AM | -110 | 52.380952% |
| 11:30:21 AM | -105 | 51.219512% |
| 4:30:24 PM | -110 | 52.380952% |
| 5:45:09 PM | -110 | 52.380952% |

Kalshi history began at 12:15 PM in the inspected receipt. Using the later
source's first timestamp as the shared start clipped both early Circa anchors.
The remaining five-hour interpolated connector appeared to be an observed
gradual rise. The prices and implied-probability arithmetic were correct; the
presentation was not. No locked payload is corrupt or being corrected.

## Rendering contract

- Preserve the earliest actual observation on a common time axis, within the
  existing source retention bounds. Never truncate the book's dip/return merely
  because Kalshi starts later. Missing earlier data stays blank; label a source's
  later start in the legend. Both still stop at the existing shared cutoff.
- Both sources use the same bounded monotone-curve geometry and 15-minute gap
  rule. Dense recorded runs stay solid and rounded. Longer gaps use a clearly
  dashed connector between their exact endpoints, not a solid observed trend.
  Dashed connectors are visual guides, not estimates of prices in the gap.
- Area fills stop at gaps. No quote, timestamp, or activity sample is added.
  Inspection continues to return actual observations, never interpolated values.
- Show a bounded set of actual endpoint/minimum/maximum dots. Label interior book
  extrema with their original American prices. A three-price round trip reads
  `-110 → -105 → -110`, not a misleading `-110 → -110` headline.
- Keep the existing held-tail distinction, same-book/side/point-line matching,
  nearby-contract labels, frozen reference precedence, and market-specific feeds.

## Locked-record integrity and verification

This only renders the exact original stored observations differently; every
stored locked projection, probability, pick, grade, price, stake, timestamp,
line and evidence field retains precedence and remains byte-for-byte unchanged.
There are no database writes or reconstructions of locked values.

The ATL regression fixture uses the exact above stored anchors and verifies
their visibility, 52.38 → 51.22 → 52.38 ordinate sequence, dashed sparse gaps,
absence of area fills over unknown intervals, source timestamp inspection,
missing-history blank behavior, dense shared geometry, writer immutability and
locked-reader precedence. Existing display/contract/comparison/capture tests,
shared-reader regression, TypeScript/lint, model-safety suite, production build,
fresh-main safety and actual desktop/mobile/live checks remain required.
