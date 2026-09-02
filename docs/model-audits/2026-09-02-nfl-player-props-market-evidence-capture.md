# NFL Player Props Forward Market Evidence Capture

Date: 2026-09-02
Base: `d4011de2da10fa2303c79bf2d1c1a9243cd40f1e`
Capture release: `nfl_player_props_market_evidence_capture_2026_09_02_r1`
Schema: `nflpme1`

## Disposition

This candidate is behavior-neutral forward evidence capture. Existing NFL
props model, calibration, decision, projection, board, member, writer,
tracking, settlement, grade, stake, lock, and lease releases remain unchanged.
The sole production writer reuses its already-collected exact offers and its
existing snapshot write. It adds no provider call, query, table, cron, writer,
or database write.

One deterministic game/player/market/line identity owns the compact book
array. Complementary Over and Under decisions reference it by the same 16-hex
ID. At most eight complete, fresh books are retained. Each book records short
provider/source-class enums, current observation/fetch timestamps and clock
skew, same-book opening timestamp/line/prices, current two-sided or milestone
price, and an evaluated-side bitmask. That mask identifies the exact-price
book so future forecast-alternative interpretation can exclude it. Source-
stratified book selection and category/hash round-robin identity retention are
deterministic and avoid first-N bias.

The identity also records complete/incomplete/stale breadth and explicit
complete, singleton, incomplete, stale, or missing comparator states; the
incumbent independent-residual coefficient; the separate quarterback point-
projection coefficient when used; independent and published point outputs;
and incumbent raw/market/final probability, edge, exact-price EV, and grade by
side. `sp=n` truthfully declares no verified NFL prop split input, so missing
split evidence remains neutral.

## Latest stored-slate replay

The read-only replay used the latest stored Week 1 snapshot at
`2026-09-02T11:51:09.409Z`. It made no provider call and no database mutation.
The stored snapshot omits fetch timestamps from its legacy per-decision
`bookEvidence`, so replay used the stored observation timestamp in the fetch-
timestamp slot; this affects neither tuple count nor serialized timestamp
length and is explicitly not represented as live captured skew.

| Measure | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| Full canonical JSON bytes | 9,071,155 | 9,510,622 | +439,467 |
| Hard added-byte limit | - | 524,288 | 84,821 headroom |
| Canonical decisions | 1,137 | 1,137 | 0 |
| Member decisions | 1,074 | 1,074 | 0 |
| Complementary identities | 701 | 701 retained | 0 omitted |
| Reconstructed book observations | 1,109 | 1,109 | 0 |
| Complete reconstructed offers | 1,077 | 1,077 | 0 |
| Maximum books per identity | - | 6 | within 8 |

The capture retained all populated replay categories: 64 passing-yards, 97
receptions, 113 rushing-yards, 162 receiving-yards, and 265 anytime-touchdown
identities. The production board remains exactly 8 Best Angles, 32 Leans, 93
Watchlists, 941 No Plays, and 63 Held (40 actionable). Promotions, demotions,
side changes, probability changes, projection changes, price changes, stake
changes, and board-count changes are all zero by construction and assertion.

## Bounds and verification

- A 4,400-identity oversized fixture retains 1,679 identities within 524,288
  added bytes: 210 each for passing attempts, passing completions, passing
  yards, rushing attempts, receptions, rushing yards, and receiving yards;
  209 anytime-touchdown identities. Reversed input produces the identical
  capture.
- Canonical production and member snapshots are byte/value/order/count
  identical after removing only `marketEvidence` and `marketEvidenceId`.
- A locked replay keeps the exact prior decision and prior evidence tuple even
  when the next unlocked input changes price, projection, probability, and
  grade.
- Tests cover shared complementary identity, target masks, target-excluded
  singleton breadth, exact timestamps/skew/opening trail, incomplete/missing
  reasons, the eight-book cap, source-stratified retention, and the unchanged
  singular provider/snapshot/tracking paths.
