# NFL player-props Owls source cutover predeclaration

Date: 2026-10-28  
Owner direction: replace the canceled Sharp API dependency with Owls Insight, verify the live feed and model behavior, and publish only after production checks pass.

## Proposed change

- Keep BALLDONTLIE as the authoritative NFL slate, player-identity, retail-current, and provider-opening source.
- Replace every NFL player-prop Sharp API request with one bounded Owls Insight `/api/v1/nfl/props` request.
- Normalize Owls current pregame prices into the existing provider-observation contract.
- Use qualified Owls Pinnacle and NoVig offers for the existing target-book-excluded reference lane. Other Owls books may contribute current price coverage but cannot become reference authority merely because they are present.
- Require exact team, kickoff, and unique-event reconciliation to the BALLDONTLIE slate; unmatched or ambiguous rows are rejected rather than guessed.
- Require valid provider timestamps, complete over/under price pairs for two-way markets, and non-live events. Empty, malformed, stale, or failed Owls data must be explicit in health findings and cannot manufacture an offer.
- Preserve all stored locked projections, probabilities, picks, grades, prices, stakes, and market evidence byte-for-byte. New source semantics apply only to unlocked rows and future locks.

## Provider evidence already observed

A read-only live Owls inventory at approximately 2026-10-28 03:20 UTC returned 14 NFL games, 3,000 raw offers, seven books, and timestamps between 03:15 and 03:20 UTC. The five currently active model markets had 776 offers, including NoVig coverage on nine games and Pinnacle coverage on one game where Pinnacle had posted. This proves current availability and freshness for the candidate window; it does not prove improved prediction accuracy.

## Releases and invariants

Because reference prices and current market inputs can change forecasts and decisions, the active NFL player-props provider, model, calibration, decision, runtime, board, member, lifecycle, writer, and tracking release identifiers will be bumped together. The existing `prediction_pipeline:nfl` lease and sole writer path remain authoritative. No independent refresher or writer will be introduced.

## Required evidence before publication

1. Provider contract tests for schema normalization, price-pair completeness, freshness, exact event identity, ambiguous-event rejection, one-request bounds, and explicit failure health.
2. Locked-reader precedence and writer-immutability tests proving existing locked rows are unchanged.
3. Same-input before/after board comparison reporting changed sides/probabilities, promotions, demotions, and actionable board count.
4. A live no-write collection proving Owls coverage, qualified reference coverage, and zero database writes.
5. Focused NFL player-props tests, typecheck, build, and `npm run verify:model-change`.
6. Post-deploy verification of the live release identifiers, cron health, model coherence, data coverage, and reader snapshot.

## Rollback

Rollback is the prior committed release family and prior BALLDONTLIE-only survivability behavior. Sharp API is not an acceptable production rollback because the subscription was canceled. If Owls is unavailable, the existing health hold and retained locked evidence behavior must remain in force; no synthetic or stale reference quote may be substituted.
