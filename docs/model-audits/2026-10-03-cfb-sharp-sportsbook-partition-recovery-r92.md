# CFB SharpAPI sportsbook-partition recovery r92

## Scope and predeclaration

The production CFB board had coherent predictions and reference lines for every remaining game,
but current prices were absent for NWST-LAM and SDST-ILST. Provider inspection proved that SharpAPI
published each exact matchup and kickoff under multiple event IDs, with different sportsbooks
partitioned across those IDs. The r14 guard correctly refused to guess between multiple exact
kickoff IDs, but therefore discarded verified named-book prices that were actually available.

This repair may change future unlocked market inputs and therefore follows the model-change safety
protocol. It does not change score equations, PMF equations, probability calibration, market-read
rules, play-grade thresholds, stakes, member copy, labels, layout, schedules, the sole
`prediction_pipeline:cfb` lease, or any existing lock. It must not merge quotes across event IDs or
manufacture a price.

## Released behavior

1. A still-current retained event ID keeps first priority.
2. Otherwise, duplicate strict-team matches are eligible only at the exact scheduled kickoff.
3. One event may win only by a unique lexicographic sportsbook footprint: trusted consensus-book
   count, eligible target-book count, then provider-declared book count.
4. A tie or incomplete identity remains ambiguous and makes zero odds calls.
5. A provider team name that differs only by one leading `U` marker may match the exact scheduled
   team; every other strict identity rule remains in force.
6. The current collector release is an immediate refresh boundary for upcoming unlocked games.
   Started and locked cards remain terminal.
7. The 24-game / 192-request limits remain unchanged. The existing attempt deadline advances from
   40 to 60 seconds because a verified 24-game, 46-request provider batch completed in 35.627
   seconds alone and was intermittently cancelled when run concurrently inside the writer. The
   containing leased route retains its five-minute platform boundary.

## Outcome-blind provider and production-path evidence

- Direct provider proof resolved all three audited partitioned matchups without a guessed ID:
  DSU-UALB, SDST-ILST and NWST-LAM.
- SDST-ILST returned six named books and complete Moneyline, Spread and Total pairs.
- NWST-LAM returned six named books and complete Spread and Total pairs. No complete Moneyline pair
  was returned, so Moneyline remains unavailable rather than being synthesized.
- DSU-UALB returned four real named books after the strict UAlbany alias repair. Because that game
  was already locked, r92 does not rewrite its card.
- The complete 39-game current-slate dry run proposed 37 unlocked and two T-60 captures, published
  all 117 forecast directions, and produced zero capture or cross-market score/side coherence
  failures. Its evaluated exact-price surface was 11 Best Angles, 33 Leans, 23 Watchlists and four
  No Plays across 71 markets, with 46 markets held. This is not a grade-rule recalibration; changes
  come only from fresher verified inputs.
- The direct 24-game fallback reproduction used 46 requests, matched 20 games, isolated three
  individual four-page overflow events, and completed without aborting the other games.

## Acceptance and rollback

- Focused Sharp odds and complete CFB production-contract tests must pass.
- TypeScript and `npm run verify:model-change` must pass.
- Publication must use a clean, latest-main PR and pass integration safety and protected checks.
- After deployment, run the sole production writer, prove the r92 writer/r40 collector/r15 odds
  releases, verify all remaining games have three predictions, verify recovered price coverage,
  prove no terminal lock changed, and observe the next natural T-60 lock and tracking cycle.

Rollback the r15/r40/r92 release trio together. Preserve append-only evidence, locks and tracking
rows. The prior r14 resolver remains fail-closed but again withholds provider-partitioned books.
