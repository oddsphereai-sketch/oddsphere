# CFB verified quote and market-flip continuity

## Predeclaration

- Incident: the October 3 member board drops previously verified two-sided
  prices, Spread/Total predictions, and exact-line context when a later provider
  cycle returns no quote. The defect is board-wide across FCS coverage rather
  than isolated to one matchup. A separate score-coherence defect permits a
  money-minus-ticket Spread divergence to reflect the complete score
  distribution and flip the outright winner even when the selected side does
  not hold a majority of the reported money.
- Production candidate: retain the latest verified paired named-book quote for
  each sportsbook and market from the existing immutable market-history read
  whenever the current cycle omits that market. A fresh verified market always
  supersedes the retained market. Use the complete market-history split trail,
  rather than the release-transition payload subset, for the already released
  Spread-signal continuity rule. Require the side that can reflect the complete
  score distribution to hold at least 50% of reported Spread money in addition
  to the released book-count and money-minus-ticket tests.
- Product surface: no new member copy, labels, warnings, badges, routes, writer,
  cron, or request loop. Original quote timestamps and sportsbook identity stay
  intact. The existing `prediction_pipeline:cfb` lease and sole writer remain
  authoritative.
- Selection evidence: weeks 1-2 of the release-pure 2026 replay plus exact
  current-board coverage/coherence. Confirmation evidence: week 3 onward,
  opened once after the rule is frozen. Report Moneyline and Spread direction,
  margin/team-score error, side changes, and the complete current-board grade
  distribution.
- Acceptance: previously verified prices and line-specific predictions do not
  disappear; fresh quotes win market by market; zero score/prediction
  contradictions; selection and confirmation do not materially regress; the
  current board remains non-flat; provider requests and schedules do not grow.
- Rollback: the complete October 3 spread-signal-continuity release family.

## Result

- The incident reproduced in production: evidence captured through October 3
  existed, but the compact board published an October 1 release because the
  bounded writer reader skipped the immediately previous release. A later
  unlocked refresh could also replace an already-valid immutable T-60 row.
- The candidate loads the immediate and bounded fallback release chain, makes
  immutable locks terminal across transitions, and retains verified quote and
  split evidence from the existing market-history read. It adds no provider
  call, cron, writer, label, copy, or layout.
- Release-pure 230-game replay improves Moneyline 193-37 to 194-36, Spread
  120-110 to 122-108, margin MAE 13.391 to 13.318, and team-score MAE 9.471 to
  9.392. The untouched confirmation segment improves Moneyline 109-25 to
  111-23 and Spread 68-66 to 70-64. The selection segment keeps Spread at
  52-44 while Moneyline moves 84-12 to 83-13; the small selection tradeoff is
  accepted against stronger confirmation and overall results.
- Exact current-board replay reports zero coherence failures and increases
  actionables rather than flattening the board. Already-locked games remain
  unchanged; the new market rule applies only to unlocked evidence.
