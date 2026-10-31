# CBB continuous market tracking

Starting base: `0ad30e17a8901dafad6634fd6a4fea4ad8940cdb`.

The owner reported missing price/line tracking and an empty prediction-market
graph for Liberty–High Point. The dedicated CBB reader must expose available
observations and automatically retain new ones as early-season markets open.

Three display defects are repaired:

- Optional book-history downloads share a bounded daily allowance. Published
  current observations were repeatedly replaced instead of accumulated when
  backfill was deferred. The existing capture now retains both actual outcomes
  and exact-game pre-lock display observations for future unlocked CBB games.
  This adds no writer, schedule, source request or budget. Existing provider
  opening evidence wins; a first recorded quote is never called an opener.
- Liberty–High Point's canonical start is one minute before the independent
  sportsbook start, across Eastern midnight. Its Kalshi event therefore failed
  exact calendar matching. A unique event with both exact institution names
  and a start within one minute can prove the display date for an open future
  game. Names, uniqueness, freshness and contract/threshold checks still apply.
  The canonical fixture and every locked reader semantic remain unchanged.
- A shared global row cap let repeated named-book observations crowd public
  consensus out of the reader. Public consensus now uses its own fresh,
  deterministic bounded pagination; named-book display reads the existing
  durable exact-game feed and retains the complete-pair/freshness contract.

CBB's existing feed bounds are widened for a normal large Division I slate;
other sports keep their previous limits and behavior. Current quote timestamps
are deduplicated when merging the reader trail. A transient Kalshi source
failure retains its existing observations and no longer interrupts CBB's
ordinary sportsbook capture. Missing public-consensus observations remain
unavailable, and a nearby Kalshi total remains explicitly labeled nearby.

Releases:

- `cbb_market_tracking_2026_10_31_r1_observed_tape_verified_midnight`
- `cbb_reader_evidence_2026_10_31_r3_source_scoped_tracking`

The same-input production-data replay recovers available book history across
the analyzed board and matches Liberty–High Point's exact spread contract.
Forecasts, probabilities, picks, grades, evaluated prices and stakes are
identical: zero promotions, zero demotions and zero actionable-count change.
Detailed provider/production receipts remain local. No accuracy claim is made.

Validation includes continuous-capture regressions with an exhausted budget,
both outcomes, real threshold changes, first-observation provenance, duplicate
terminals, future observations, cross-game archives, a 119-game/714-entry
opening-day fixture, independent midnight proof, ambiguous/wrong-name/time
rejections, exact contracts, untouched input objects and locked records.
Existing CBB grade/writer/store, Kalshi lifetime, CFB date matching, locked
continuity and public-tracker tests are also required, along with TypeScript,
focused lint, the full model-safety suite and a production build.

Publication requires fresh-main integration safety from a clean committed
worktree, protected PR checks, matching local/remote trees and verification of
the deployed release and actual scheduled capture/reader output. Rollback
reverts this commit's display changes; existing member snapshots and locked
records are never reconstructed or overwritten.
