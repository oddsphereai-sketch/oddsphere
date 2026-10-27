# NFL player-props Passing Completions direction predeclaration

Date: 2026-10-27
Starting production base: `81e99c5ac99b76fdc7db89f5b19f28a3cd9861db`

## Owner direction

Daniel Mengel directed Oddsphere to improve player-prop prediction accuracy and investigate the
visible Under concentration without adding an Over quota, flattening the board, or changing UI
copy. NFL and NBA are the current priority.

## Fixed candidate

This audit is limited to future-unlocked NFL **Passing Completions** forecasts. When the independent
Passing Completions direction and target-book-excluded market direction disagree at the exact
canonical member line, the candidate gives the qualified cross-book direction forecast authority.
The independent point projection remains market-free. Target-book price, same-book movement,
exact-price economics, and the existing grade formula remain downstream evidence. No other market,
provider call, cadence, writer topology, UI, copy, label, or locked payload changes.

This is not a generic market-follow rule or a projection lift. It was fixed after a release-pure
Weeks 6-7 diagnosis isolated Passing Completions as the quarterback volume market with a consistent
low-direction defect: selected Overs won more often than selected Unders, independent projections
were negatively biased, and target-book-excluded market direction improved both weekly blocks.

## Required confirmation

- Report direction hit rate and Brier score by chronological week, not only in aggregate.
- Replay the current unlocked production writer and report every Passing Completions side change,
  promotion, demotion, and actionable-count change.
- Reject the candidate if it improves only by adding Overs, fails a later block, or flattens the
  board without paired promotions.
- Preserve exact locked writer and reader precedence and bump every affected release identifier
  before any production publication.

The audit is SELECT-only. It cannot rewrite a lock, settle a result, or authorize a production
change without the required confirmation and model-change verification.
