# Owls current-odds cutover — 2026-10-27

## Decision

The owner cancelled SharpAPI and directed Oddsphere to replace its active
current-odds role with Owls. This release moves the NBA and NHL authoritative
full-game line refreshes to one Owls league request per cycle. Playbook remains
the Public Consensus source; existing retail rows remain a coherent same-book
fallback. This release does not add player-prop coverage.

## Accepted evidence

- Only complete two-sided full-game Moneyline, Spread, and Total pairs are
  accepted.
- Only Circa and Pinnacle rows enter through this Owls lane.
- Exact canonical home/away identity and a bounded start-time match are
  required. Unknown and ambiguous games fail closed.
- The provider timestamp is stored in append-only `line_history`; poll time is
  not substituted when Owls supplies a valid observation time.
- A partial or missing game/market response preserves the last complete board
  and marks the refresh partial. It cannot erase a side or publish a complete
  slate.
- Current-table replacement is scoped to the returned game/market/book group.
  Existing retail books are not relabeled as Circa/Pinnacle and are not deleted.

At 22:58 UTC on October 27, the read-only live probe returned:

| Sport | Scoped games | Complete rows | Circa | Pinnacle | Newest age | Rejected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| NBA | 4 | 48 | 24 | 24 | 14 seconds | 0 |
| NHL provider board | 13 | 144 | 66 | 78 | 14 seconds | 0 |

The exact slate writer rehearsal matched all 48 NBA rows to the four stored
games. The NHL writer matched 132 rows to all 11 stored pregame games; the 12
unmatched rows belonged to two provider games outside the stored ET slate.
Both rehearsals had zero incomplete-market coverage errors.

## Board impact and release boundary

The NBA same-model read-only comparison covered six analyzed games / 18
markets and compared the current stored board with the actual post-cutover
composition (retained retail rows plus fresh Owls Circa/Pinnacle rows). It had
zero pick changes, zero price changes, zero promotions, zero demotions, and an
unchanged 0-to-0 actionable count at the audit timestamp.

The NHL price comparison covered 11 games and 132 candidate rows. Of 126
existing sharp-book identities, 14 had genuine current price or number changes;
six Circa identities were newly available. These are provider-market changes,
not a new grading rule. Because current prices are model inputs, the NHL model,
calibration, and decision identifiers still advance together. Existing locked
records render their exact stored payload first and are never recomputed. The
unlocked writer retains the existing grade and promotion rules and remains
inside the sole `prediction_pipeline:nhl` lease. No demotion-only rule is added;
therefore no paired promotion rule is required by this source cutover.

NBA advances to model r22 / market-marriage r23. NHL advances to model,
calibration, and decision r23. The release change prevents results from the
old provider board and the Owls board from being blended under one identifier.

## Member movement contract

Opening, prior, and current values must all belong to one sportsbook. The
member reader ranks a complete three-point trail ahead of book branding, then
prefers Circa, Pinnacle, and Bookmaker when trail depth is equal. A current-only
Circa quote cannot replace a complete retail trail. Locked cards preserve their
stored book and trail exactly.

## SharpAPI retirement boundary

The NBA/NHL daily crons, T-60 pregame sweep, tracking refresh, Daily Edge
request path, and NHL public-split observation writer make no new SharpAPI
odds, split, or EV request. Historical SharpAPI rows remain unchanged for lock
provenance and audits. Legacy client helpers are retained only for historical
tests and explicit offline tooling; no active NBA/NHL entry point supplies the
legacy key.

## Rollback

Disable the NBA/NHL Owls refresh stages and restore the preceding release only
if exact game identity, complete-pair validation, provider timestamps, or
current-board replacement fails. Do not relabel stored Owls rows, delete line
history, or alter a locked record. A rollback may use the last complete stored
board while the provider issue is investigated.
