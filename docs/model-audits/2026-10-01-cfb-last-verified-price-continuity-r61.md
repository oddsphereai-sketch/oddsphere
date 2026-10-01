# CFB last-verified price continuity r61

## Decision

Promote a member-snapshot continuity repair that keeps the newest verified
pregame named-book quote visible when a later provider response omits that
market. The repair is presentation-only: it does not feed the retained quote
back into the score model or exact-price grading path.

## Production defect

The October 1 CFB snapshot contained all 99 games and all 297 prediction
markets, but a later empty SharpAPI response removed two previously verified
McNeese-LSU offers from the member surface:

- BetRivers McNeese +52.5 / LSU -52.5 at -112, observed
  `2026-10-01T10:24:52.303Z`.
- BetRivers Over 61.5 at -118 / Under 61.5 at -106, observed at the same time.

The bounded market-history reader already retained those immutable
observations for movement reconstruction. The member fixture considered only
the newest payload for its displayed current quote, so the later empty payload
incorrectly erased them.

## Repair contract

- A valid quote in the newest payload always wins.
- Otherwise, select the newest valid pregame quote for the predicted/context
  side from the existing bounded compatible market history.
- Preserve the real book, price, line, and observation timestamp.
- Keep the same-book movement trail intact.
- Do not create a pick, probability, Bet grade, stake, lock, or tracking tuple.
- Add no member-facing copy, stale badge, substitute label, provider request,
  writer, or cron.

## Exact-input replay

The read-only production replay covered 99 games and 297 markets. On the
59-game FBS-involved default board, verified displayed prices move from 171 of
177 market slots to 173 of 177. The four unavailable default-board slots are
McNeese-LSU Moneyline and all three SJSU-Hawaii markets; no verified named-book
price has ever been captured for those offers. On the optional all-Division-I
board, 108 additional unavailable slots belong to 36 FCS-only games for which
no provider has ever supplied a verified price. The only restored observations
are the two verified McNeese-LSU markets above.

Predictions, projected scores, probabilities, sides, grades, actionables,
stakes, and locks changed 0. The board remains 17 Best Angles, 77 Leans, 58
Watchlists, and 145 No Plays in the stored production snapshot.

## Releases and rollback

The sole writer is
`cfb_forward_evidence_writer_2026_10_01_r82_last_verified_price_continuity`.
The fixture/outcome releases are
`cfb_v1_member_fixture_2026_10_01_r61_last_verified_price_continuity` and
`cfb_market_sharp_public_outcome_contract_2026_10_01_r56_last_verified_price_continuity`.
The compact snapshot/reader releases are
`cfb_forward_member_snapshot_2026_10_01_r20_last_verified_price_continuity` and
`cfb_member_snapshot_reader_2026_10_01_r9_last_verified_price_continuity`.
The r19/r60 snapshot family remains the explicit reader fallback. Roll back
these five publication releases together; the immutable evidence rows require
no rewrite.
