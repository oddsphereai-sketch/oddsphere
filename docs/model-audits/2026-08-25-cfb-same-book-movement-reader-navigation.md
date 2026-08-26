# CFB same-book movement and reader navigation repair

Date: 2026-08-25

Scope: member evidence adapter and shared Daily Edge reader navigation only. This repair does not alter the CFB score model, probabilities, exact-price decisions, grades, T-60 locks, tracking eligibility, provider collection, cadence, or writer lease.

## Read-only production finding

- The current opening-week package contained 16 immutable rows: two waves for each of eight games.
- Twenty-one priced markets had at least two timestamped observations from the exact sportsbook used by the current decision; three SJSU-USC markets were Held because no complete exact-price tuple existed.
- UNC-TCU Moneyline contained a real DraftKings move from TCU -325 to -310.
- The other twenty priced markets were flat across the two stored observations.
- The r2 CFB member fixture discarded every earlier row after selecting the latest row per game. Its trail builder could therefore use only the operational opening stored on that latest payload. When that opening book differed from the evaluated book, the reader rendered a current-only trail even though exact same-book history existed.

## Frozen repair contract

- The reader fixture release advances to `cfb_v1_member_fixture_2026_08_25_r3_same_book_history`.
- The latest current-schema row remains authoritative for forecasts, prices, decisions, grades, availability, splits, and T-60 state.
- Earlier current-schema rows from the same active weekly window may supply evidence display only, including rows collected before a member/decision release rollover. The latest row remains release-strict; historical odds compatibility is governed by the immutable evidence schema so a writer-version bump cannot erase a valid earlier same-book quote.
- A trail must use one normalized sportsbook identity, preserve the first observation, every material line or price change, and the current or locked endpoint, and remain chronological.
- Consecutive unchanged captures are compressed. A flat market retains truthful first/current endpoints without being described as movement.
- The full immutable row set, not only the latest row, contributes to the member fixture source checksum.
- Mobile reader sport tabs route through the existing canonical sport-switch function, close the transient reader, and clear game/market query state. Desktop behavior remains unchanged.

Rollback: restore member fixture r2 and the prior mobile sheet. Stored evidence and all model/tracking releases remain untouched.
