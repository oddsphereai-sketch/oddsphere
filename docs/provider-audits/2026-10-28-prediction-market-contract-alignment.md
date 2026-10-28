# Daily Edge prediction-market contract alignment

Display-only release `kalshi_reader_contracts_2026_10_28_r1` and historical-price
parser `kalshi_display_candles_2026_10_28_r2_sparse_prices`.
Starting production base: `7545f7438d41dedb6491e1c44191022b36aed05a`.

Daniel reported fragmented Kalshi plotting and a game-winner chart on Spread.
He explicitly requested a useful resolution to mismatched increments, not
disqualifying a provider. The final implementation does not ship the temporary
moneyline-only guard considered earlier.

## Reader contract

- Moneyline retains its original separate feed and team-specific same-book trail.
- Total, spread/puck line, and EPL/UCL BTTS use their own whitelisted full-game
  series and the published reader's selected side and line.
- A matching half-point line uses its actual YES/NO contract. Positive spreads
  use NO on the opponent's corresponding winning-margin contract.
- At integer `n`, the adjacent half-point contracts identify the push. For tails
  `a=P(X>n-.5)` and `b=P(X>n+.5)`, win probability conditional on no push is
  `b/(1-a+b)` for Over/favorite, and `(1-a)/(1-a+b)` for Under/underdog. This is
  not averaging handicaps, not a model prediction, and not a directly traded
  quote. Derived bid and ask are null. Source contracts and timestamps remain
  attached, and the reader labels the result push-adjusted.
- Both source receipts must match exactly; crossed/incoherent probabilities or
  unmatched historical timestamps cannot form a derived observation.
- If the exact line or complete push bracket is unavailable, retain an actual
  nearby contract with its own handicap and an explicit sportsbook-line label.
  Never relabel nearby prices as the same wager or substitute moneyline.
- The book curve uses one named book at the requested point line only. Other
  point lines cannot become price movement for that contract. The existing
  full line/price tracker remains unchanged.
- No verified MLB first-inning Kalshi series was present in discovery. It does
  not borrow an unrelated game-winner or five-inning contract. CBB stays disabled.

## Plot integrity

Both curves connect real observations with bounded, non-overshooting cubic
connectors. Inspection returns observed data, not an interpolated quote. Sparse
historical prices are retained at their real last-observed minute even if the
five-minute activity interval is incomplete. Such volume stays null, not zero.
The versioned history parser refills old display history once within the existing
bounded history budget. Single observations and unchanged prices never acquire
invented movement.

## Collection, cost and authority

The existing five-minute `sharp_book_splits_refresh` and its sport lease remain
the sole scheduled owner. There are no new timers, models, prediction writers,
leases, or member-triggered provider calls. Two additional OWLS series calls per
active sport are the maximum, except MLB uses one. Empty published slates skip
those new calls. The eight supported sport/competition lanes have a combined
ceiling of 15 extra OWLS calls/cycle: 4,320/day or 129,600 per 30 days before
empty-slate savings. This is a request ceiling, not a billed-usage estimate or
permission to upgrade a subscription. The existing key reported 296,780 monthly
requests remaining at 22:01 UTC; MVP documentation lists a 300,000 monthly cap.

Historical quote backfill retains the existing global ceiling of 60 contracts
and three sequential public Kalshi batches per sport/cycle, now shared fairly
between market types. Only raw source contracts required by the published board,
including both push brackets, are stored. Existing 1.5 MB/1,200-row retention
bounds apply separately to each kind; stale receipts retain original timestamps.
Failures retain earlier contracts and report partial status without cancelling
the independent sportsbook split capture. Cron accounting reports actual OWLS
request counts on success and a labeled ceiling if capture throws.

All new writes target separate `lab_response_snapshots` display keys. Published
member snapshots are SELECT-only. No stored projection, probability, pick, grade,
stake, locked evidence, writer, tracking result, or internal market-reader input
is modified. Existing model releases therefore remain unchanged.

## GET/SELECT-only rehearsal

At 21:59 UTC the current board matched all 12 tonight NBA spreads (7 exact,
4 push-adjusted, 1 nearby), all four NHL spreads and totals, all 14 NFL spreads
and totals, all 10 EPL totals/BTTS, and all 18 UCL totals/BTTS. NBA totals had
4 exact and 8 labeled nearby lines. CFB selected-price coverage was 22 spread
and 22 total contexts; missing unpriced/future scopes were not invented.
Minnesota -4 resolved from its -3.5/-4.5 contracts, not moneyline; Over 227.5
matched exactly. The revised sparse-price parser recovered 96 Minnesota total
observations and 40 synchronized spread observations in the bounded rehearsal.

These are coverage/identity checks, not accuracy or predictive-performance claims.
Focused source/contract/history/immutability tests, shared-reader regression,
TypeScript, lint, full model-safety command, build, fresh-main integration check,
and live post-merge verification are required before declaring completion.
