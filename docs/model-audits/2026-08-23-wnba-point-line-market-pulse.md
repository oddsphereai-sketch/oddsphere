# WNBA point-line Market Pulse coherence

Status: reader-only production candidate. No model, probability, selected side,
grade, evaluated price, stake, writer, lock, or tracking behavior changes.

## Defect

The WNBA adapter correctly generated a dedicated same-book point-line trail for
Totals and Spreads. The compact line tracker and the canonical market read used
that trail, but the detailed Market Pulse validated direction using only the
selected-side price trail. When no earlier price existed at the current point
line, the same card could display `Strong Market Support` in its market tab and
`Directional Move Unavailable` in the detailed pulse.

## Correction

For a Total or Spread with a verified point-line move, Market Pulse now uses the
same dedicated line trail as the canonical market read. It accepts the trail
only when one sportsbook owns at least two observations and the visible first
and current line/price endpoints exactly match the canonical movement tuple.
Any mismatch fails closed to the existing exact-price movement path. The
two-sided price rows remain separate context and are not rewritten.

## Read-only production-data proof

The candidate reconstructed the natural 2026-08-23 WNBA snapshot without
invoking a cron or writer:

- WSH@POR Spread: POR +4.5, Watchlist, evaluated/current -104.
- Canonical read: `Strong Market Support`, direction `support`.
- FanDuel point-line trail: +3.5/-104 at 2026-08-22T18:23:14.119Z to
  +4.5/-104 at 2026-08-23T13:23:26.920Z.
- Candidate pulse resolution: coherent FanDuel +3.5 to +4.5, support.
- SEA@DAL correctly did not use point-line direction because its opening and
  current number were both +7.5. Its verified selected-side price move remained
  resistance, preserving the legitimate current state.

## Board impact

- Promotions: 0
- Demotions: 0
- Actionable-count change: 0
- WNBA release identifiers: unchanged

## Validation

- Daily Edge experience regression: 110/110
- Focused ESLint: pass
- TypeScript no-emit: pass
- Full model-change verification: pass
- Integration-safety verification: pending final committed candidate
