# NFL verified full market trail and active-reader movement — 2026-10-22

## Owner finding

After the current-quote repair, NE-CHI moneyline displayed Caesars `+136 →
+136` and “Market flat.” That removed the false implication that a current
price was stale, but it also removed a real provider-native opening and left
the active NFL recommendation reader's `lineMovement` null.

## Source proof

- Exact provider event: `1392309`, NE at CHI, kickoff October 23 at 00:15 UTC.
- Caesars provider opening: August 5 at 00:11:14 UTC, NE -105 / CHI -125.
- Fifty retained writer snapshots from October 20 at 04:06 UTC through October
  22 at 10:51 UTC all contain Caesars NE +136 / CHI -162.
- Event identity, both teams, sportsbook, two-sided pairing, chronology, and
  current endpoint all match. This is a real long-range opening followed by a
  move that occurred before Oddsphere's retained hourly capture window.

No intermediate pre-October-20 quote is invented. The honest known trail is
opening, first retained quote, and current quote.

## Correction

Future-unlocked NFL cards accept a provider-native opening for the exact event
whenever it predates kickoff. The trail remains same-book and ends at the exact
current displayed tuple. The reader derives direction from the same displayed
trail: point movement takes precedence; otherwise an implied-probability move
of at least one percentage point is required. Invalid or cross-book evidence
fails neutral.

NFL member fixture/snapshot advance to:

- `nfl_weekly_member_fixture_2026_10_22_r48_verified_full_market_trail`
- `nfl_forward_member_snapshot_2026_10_22_r40_verified_full_market_trail`

The underlying model, score distribution, probabilities, exact-price decision,
grades, stakes, writer, cadence, sport lease, lock boundary, settlement, and
tracking releases do not change.

## Same-input impact

The production 14-game / 42-market Week 7 input produces:

- zero pick changes;
- zero grade changes;
- zero current-price or current-book changes;
- zero resolved reader-status changes;
- zero actionable-count changes;
- 42/42 markets with a changed known observation;
- 42/42 markets with at least three retained stops;
- zero deep-audit criticals or warnings.

Board grades remain 12 Best Angles, 6 Leans, 12 Watchlists, and 12 No Plays.
NE moneyline becomes Caesars `-105 opening → +136 first retained → +136
current`, with `lineMovement=resistance`. Its already-visible resistance status
does not change because consensus and sharp-book splits were independently
against NE as well.

## Cross-sport boundary

The audit continues to validate current-price freshness, chronological trails,
terminal price/book identity, plausible odds, split coherence, and locked
immutability on every Daily Edge sport. It now counts the active reader surface
instead of only `marketReadV2`. NFL declares that its reader movement comes
from the displayed same-book trail, so omission or contradiction is critical.
Other sports keep their existing qualified reader authority and releases; this
change does not silently substitute NFL movement semantics into them.

## Publication and rollback

Publication requires focused movement, odds-contract, NFL fixture/snapshot,
deep-audit, lock-transition, TypeScript, model-change, and integration-safety
checks; a protected pull request; an NFL sole-writer refresh; and a live
zero-critical audit. Rollback restores r47/r39 only for future unlocked output.
Never rewrite or reinterpret a locked payload.
