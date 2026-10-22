# Daily Edge current-quote and opening-cycle authority — 2026-10-22

## Incident

The member NFL reader displayed a real Caesars New England–Chicago price trail whose
opening observation came from August 5 and whose current observation came from October
22. The current `NE +136 / CHI -162` pair was fresh and correctly mapped, but the
79-day look-ahead opener was not an honest description of current game-week market
movement. The existing deep audit accepted the trail because it trusted DTO stale flags
and did not independently verify current timestamps, chronology, terminal identity, or
the age of an opening landmark.

The cross-sport audit then found a separate NHL defect. The exact-quote selector ranked
American price before observation freshness, so an older complete book pair could beat
a current complete pair. Eleven current NHL market selections were more than three hours
old and three price trails ended before a later historical observation, producing
chronologically inverted trails. This defect could affect exact-price grading and the
target-excluded Total reader for future unlocked records.

## Bounded correction

- NFL and CFB retain every raw provider opener in stored evidence. For future unlocked
  member cards, only an opener observed within 14 days of kickoff can describe the
  current market cycle. If the provider opener is older, the trail begins with the first
  writer-verified same-book observation from the current cycle. Locked cards bypass this
  filter and render their exact stored legacy payload.
- NHL first canonicalizes complete two-sided market pairs, finds the freshest pair for
  the exact game and market, rejects books more than 120 minutes behind that anchor, and
  canonicalizes again so an orphan side cannot survive. Best-price selection and both
  sides of the visible trail use this same fresh board. History later than the current
  endpoint is not allowed into a trail.
- A newly deployed NHL release without its first writer record applies the same
  exact-price verdict gate as the sole writer. Stored writer verdicts, and especially
  locked records, retain unconditional precedence.
- The shared deep audit independently rejects an unlocked current quote that is older
  than 180 minutes without a fresh explicit verification timestamp. It also rejects
  inverted chronology, a terminal price or book that differs from the current tuple,
  and a long-range football opener presented as current-cycle movement.

No synthetic opening line is created. An unchanged quote can remain old only when the
sport explicitly records a fresh verification time. Economic price history continues to
store changes rather than duplicate flat polls.

## Release identities

- NHL model/calibration/decision: `nhl_regular_2026_r19_fresh_quote_authority` /
  `nhl_regular_calibration_2026_r19_fresh_quote_authority` /
  `nhl_regular_decision_2026_r19_fresh_quote_authority`
- NHL reader: `nhl_daily_edge_reader_2026_10_22_r15_fresh_quote_authority`
- NFL fixture/snapshot: `nfl_weekly_member_fixture_2026_10_22_r47_current_market_cycle_opening` /
  `nfl_forward_member_snapshot_2026_10_22_r39_current_market_cycle_opening`
- CFB fixture/snapshot/reader: `cfb_v1_member_fixture_2026_10_22_r93_current_market_cycle_opening` /
  `cfb_forward_member_snapshot_2026_10_22_r53_current_market_cycle_opening` /
  `cfb_member_snapshot_reader_2026_10_22_r38_current_market_cycle_opening`

## Zero-write board impact

- NFL Week 7: 14 games / 42 markets. The incumbent board contained 17 long-range
  current-cycle opener violations; the candidate contains zero. Picks, grades, current
  prices, current books, and actionable counts change zero times.
- CFB: 96 games / 288 markets. Both incumbent and candidate have zero long-range,
  stale-current, or inverted-trail violations. Picks, forecasts, grades, prices, and
  actionable counts change zero times.
- NHL October 22: 12 games / 36 markets. Thirteen displayed book/price selections move
  to the fresh exact pair. Picks change zero times and grades change zero times. The
  board remains 1 Best Angle, 19 Leans, and 16 Watchlists. Candidate deep-audit criticals
  are zero, including zero stale-current and zero inverted-trail failures.
- Locked records: zero stored fields are mutated or reconstructed. Reader precedence is
  unchanged; only unlocked/future output can adopt the new contract.

## Validation and publication gate

Focused odds-contract, NHL, NFL, CFB, snapshot-transition, and deep-audit tests must pass,
followed by TypeScript and `npm run verify:model-change`. Publication must use a clean
current-main PR and pass integration safety. After deployment the sole NHL writer and the
existing NFL/CFB writers must publish the new release identities under their existing
sport leases. The live deep audit must then report zero current-quote freshness,
chronology, terminal-identity, and long-range-opener criticals before success is declared.

Rollback is future-output only: restore the immediately preceding release family and
republish unlocked snapshots. Never rewrite a locked prediction or its stored odds trail.
