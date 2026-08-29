# CFB immutable-boundary release transition r36

Date: 2026-08-28

## Result

The candidate member fixture selects the successful untouched 20:39 ET r20 wave without
rewriting any evidence or violating the immutable T-60 boundary. The exact 38-game board is:

- 33 current r20 rows.
- Three last-complete r15 rows for games that had already started before later releases.
- Two r19 rows: UNH at UALB's last pregame row and WEB at UNCO's immutable T-60 row.

The SELECT-only replay used 0 provider calls and 0 writes. It produced 38 unique games / 114
market states, 35 evaluated exact-price tuples, and 79 explicit market-scoped unavailable states.
Grades are 5 Best Angles / 2 Leans / 11 Watchlists / 17 evaluated No Plays. Compared with the
prior publicly selected wave, 12 additional exact tuples become visible: three Best Angles, one
Watchlist, and eight evaluated No Plays. There are zero removed tuples, zero side changes, zero
same-market grade promotions, and zero same-market grade demotions among the 23 previously
evaluated markets. No existing tuple or grade is recomputed by this fixture-only change.

## USC acceptance

The stored r20 SJSU at USC row captured at `2026-08-29T00:39:48.387Z` is selected. It contains:

- Spread: SJSU +38.5, FanDuel -104, observed `2026-08-29T00:39:35.747Z`, No Play.
- Total: Under 61.5, FanDuel -110, observed `2026-08-29T00:39:35.747Z`, Best Angle.
- Moneyline: explicit No Play because no coherent named-target quote is available.
- Independent representative score: SJSU 16, USC 39. The spread and total prediction directions
  are therefore SJSU +38.5 and Under 61.5 at the identical displayed lines.

The reader contains neither Toss-Up nor Held. Six exact strict-split games are present; unmatched
split rows remain absent.

## Safety

- Model, probability, calibration, decision, tuple, grade, provider, cadence, writer, lease,
  tracking, and T-60 releases are unchanged.
- Fixture release advances from r24 to
  `cfb_v1_member_fixture_2026_08_28_r25_immutable_boundary_transition`.
- A future unlocked missing game still rejects a partial release. Only an already-started game or
  an exact prior `t60` row may cross the release boundary, retaining every original identifier.

Rollback is fixture r24. All evidence remains append-only.
