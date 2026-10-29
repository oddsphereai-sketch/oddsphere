# NBA executable market selection and fair-reference repair — result

Date: 2026-10-29

Status: verified candidate. Publication still requires a clean latest-main pull
request, required checks, merge, unlocked-row refresh, and live verification.
Locked records remain immutable.

## Decision

Promote r23/r24/r14 for future unlocked NBA rows. The candidate fixes the false
`no_market` condition without inventing a handicap, crossing sportsbooks, or
turning every newly priced market into a play.

- A numeric zero Spread remains the sportsbook's real pick'em line and renders
  as `PK`.
- A target-book-excluded exact-line no-vig reference remains preferred.
- When no second book offers that exact line, a complete two-sided pair from
  the selected sportsbook supplies the bounded no-vig fallback.
- Spread and Total compare complete accepted same-book offers at their actual
  numbers and prices. The offer with the greatest model expected return owns
  the displayed line, price, probability, and grade.
- An incomplete selected-book pair still fails closed.

## Exact October 29 production-input comparison

The baseline was executed from base SHA
`9b66451f241485591009484a8e005d205146a19d`; the candidate used the same live
inputs. Nine markets across three games were compared.

| Game | Market | Production base | r23/r24/r14 candidate | Actionable delta |
| --- | --- | --- | --- | --- |
| CLE at ATL | Moneyline | ATL -110, No Market | ATL -110 Pinnacle, Lean | promotion |
| CLE at ATL | Spread | ATL 0 -110, No Market | ATL PK -110 Circa, Watchlist | none |
| CLE at ATL | Total | Over 238 -110, No Market | Over 238.5 -104 Pinnacle, Watchlist | none |
| SAC at NO | Moneyline | NO -224, Lean | NO -224 Pinnacle, Lean | none |
| SAC at NO | Spread | NO -5.5 -110, No Market | NO -6 -103 Pinnacle, Watchlist | none |
| SAC at NO | Total | Over 237.5 -109, Watchlist | unchanged | none |
| MEM at POR | Moneyline | POR -270, Watchlist | unchanged | none |
| MEM at POR | Spread | POR -7 -110, Watchlist | unchanged | none |
| MEM at POR | Total | Under 234.5 -110, Watchlist | unchanged | none |

Exact release comparison: actionables increase from one to two. There is one
promotion and zero actionable demotions. No Best Angle is created. All nine
candidate markets have a coherent no-vig reference; five retain independent
target-excluded references and four use the selected-book fallback. Every
selected quote has a complete same-book opposite side.

The SAC at NO Spread change is not a forced move to a round number. Pinnacle's
real NO -6 at -103 has slightly greater expected return under the existing
distribution than the real -5.5 at -110 offer. ATL remains Circa PK because its
model expected return exceeds Pinnacle ATL -1 at -106. ATL Total uses Pinnacle
Over 238.5 at -104 rather than Circa Over 238 at -110 for the same reason.

## Prediction and reader impact

The candidate changes no independent score, final score, winner, side, reader
direction, injury input, probability distribution, stake, writer, cadence,
lease, lock boundary, or tracking rule.

The read-only current-board audit returned complete reader evidence for all
three games but no qualified categorical read. Therefore the current final
scores remain the independent scores:

- CLE at ATL: ATL 123.88, CLE 118.25 (ATL +5.63; total 242.13)
- SAC at NO: NO 124.10, SAC 117.39 (NO +6.70; total 241.49)
- MEM at POR: POR 120.50, MEM 113.15 (POR +7.35; total 233.65)

This repair does not pretend an unqualified movement sequence is a prediction
signal. It fixes executable-line selection and grading availability only.

## Verification

Passed:

- TypeScript `tsc --noEmit`
- full `npm run verify:model-change` lifecycle
- coherent fair-reference and executable-offer tests
- market-specific grade and Moneyline value/direction tests
- professional candidate, runtime artifact, site wiring, consensus, current
  line, source-eligibility, and game-input tests
- professional reader, reader-audit, and display-separation tests
- locked member precedence, lock metadata, lock coherence, T-60 lifecycle,
  and tracking-boundary tests

Still mandatory before merge and live declaration:

- latest remote-main integration and overlap review
- `scripts/verify-integration-safety.mjs`
- required PR checks and up-to-date merge
- post-merge live release, unlocked-row, quote, lock, lease, cron, and member
  snapshot verification

## Rollback

Restore r22/r23/r13 and the prior selector for future unlocked rows. Do not
rewrite, reinterpret, or replace any row locked under either release.
