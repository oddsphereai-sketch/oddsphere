# Daily Edge verified three-observation compact trail — 2026-10-22

## Owner direction

The compact football price map must show `Opening -> Prior -> Current` whenever
three real same-book observations exist. An unchanged intermediate quote is
still evidence that the market was observed and remained stable; hiding it
made the card look as though only two observations had been captured.

The same presentation contract applies to the dedicated Spread and Total line
map: a real repeated Prior remains visible between Opening and Current instead
of being collapsed merely because the point line did not change.

## Scoped correction

Member presentation advances to
`daily_edge_member_presentation_2026_10_22_r27_three_observation_trail`.
The compact renderer now exposes Prior whenever the verified same-book trail
contains an actual intermediate observation. Prior may repeat Opening or
Current. A trail containing only two observations remains two points; no quote,
line, timestamp, or movement is reconstructed.

The renderer continues to use the exact stored sequence and preserves locked
payload precedence. This correction changes no stored evidence, reader input,
reader direction, model output, projection, probability, side, price, grade,
stake, lock, tracking record, provider, writer, lease, or cadence.

## Live-board impact before publication

The 14-game / 42-market NFL board contains at least three raw observations and
at least two distinct states for every market. Thirty-one compact maps already
show three states. Eleven maps currently suppress a real repeated Prior and
will regain it: five Totals, three Moneylines, and three Spreads. All 42 active
reader directions match the verified displayed same-book trail.

Representative corrected maps:

- NE Moneyline: Caesars `-105 -> +136 -> +136`.
- PIT-NO Total: Caesars `41.5/-110 -> 44.5/-107 -> 44.5/-107`.
- DAL-PHI Total: DraftKings `48.5/-110 -> 44.5/-110 -> 44.5/-110`.
- DAL-PHI Spread: DraftKings `PHI -3/-110 -> PHI +4.5/-108 -> PHI +4.5/-108`.

## Release gates and rollback

Publication requires the focused Daily Edge experience and evidence tests,
TypeScript, lint, integration safety, protected pull-request checks, and live
verification of all three labels on a repeated-Prior card. Rollback restores
r26 rendering only; it must not mutate or reinterpret any stored locked record.
