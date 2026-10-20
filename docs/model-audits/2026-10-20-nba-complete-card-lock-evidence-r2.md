# NBA complete-card lock evidence r2

## Decision

Publish a future-only lock contract that stores the exact fully adapted NBA
Daily Edge game card on each of the atomic Moneyline, Spread, and Total rows.
The captured card becomes the locked reader authority. Only the database-owned
lock lifecycle fields may be overlaid after capture.

## Incident evidence

Boston–Detroit locked atomically at `2026-10-20T18:00:59.937Z`. Its three
immutable rows correctly contain the same internal `nba_game_dto_at_capture`,
but they predate this repair and do not contain a fully adapted member card.
After tip, `public_splits_observations_refresh` republished the board at
`2026-10-20T20:32:43.654Z`. The reader retained the locked prediction but rebuilt
display evidence from the later provider state: public consensus became empty,
and selected/opposing same-book movement trails became empty.

The immutable production row hashes before this change are:

- Moneyline `450907`: `534da4220f52d0422cd55c558214be4007593596df1a28024b83a469cd24cdb8`
- Spread `450908`: `463d35c045eee3e69c3371d1cc6a52f1a44f2c891ea90739792baadccc9664a4`
- Total `450909`: `94b67e21885b2614e5c839542d913a758fae580395b9bb31cc42bc8b8e4edfd1`

Those rows are not modified or reconstructed. Their missing display evidence is
documented as a legacy capture gap.

## Contract

- New and still-unlocked rows store
  `nba_locked_member_snapshot_2026_10_20_r2_complete_card_evidence`, the exact
  internal NBA DTO, and the exact fully adapted member card.
- All three official-market rows must carry byte-identical internal DTOs and
  byte-identical member cards with one lock timestamp.
- A partial or mismatched three-row capture fails closed.
- A future locked reader returns the stored member card before applying newer
  adapter semantics. It overlays only `lockState`, `lockedAt`, and the derived
  scheduled lock time from the authoritative lifecycle timestamp.
- A legacy lock with no fully adapted card remains immutable and is not
  backfilled from post-lock feeds.
- The sole writer, `prediction_pipeline:nba` lease, T-60 boundary, tracking
  denominator, provider calls, cadence, model, score, side, probability, price,
  grade, stake, member copy, and layout are unchanged.

## Same-input impact

This is a publication-integrity correction only. For identical inputs it has
zero score changes, zero pick changes, zero probability changes, zero price or
grade changes, zero promotions, zero demotions, and zero actionable-count
change. It prevents later refreshes from removing or reinterpreting evidence
that was visible when a future game locked.

## Verification and rollback

Required verification includes the focused locked-snapshot and professional-site
wiring tests, TypeScript, `npm run verify:model-change`, the NBA-focused suites,
integration safety against current `origin/main`, and post-deploy proof on the
next eligible T-60 lock. The production proof must show one timestamp, three
rows, byte-identical captured cards, unchanged pre-lock forecast/price/grade,
and retained public/selected/opposing evidence after a later refresh.

Rollback removes only complete-card capture/precedence and restores the prior
member-lock publication release. It must never update an already locked row.
