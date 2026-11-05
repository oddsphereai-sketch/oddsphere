# CBB coordinated source repair

Starting base: `fb905d957c02d5b09e5bc4fc79d8d3d6af35dcdf`. The compatible immutable
split archive `42a0882cc4e3380fc09d8f6006df49893245324b` was integrated before
publication; preserve its date-scoped readers and all R37 repairs.

## Problem and behavior

The CBB writer directly queried Owls odds/splits with BDL as a market-only gap
fill. It never queried The Odds API. BDL was skipped when retail covered a market,
and its additional named-book pairs were discarded even if that book supplied
missing professional context. A primary Owls failure could abort before any
alternate source. The shared Owls client also discards reset/Retry-After details;
that cross-sport rate-handling repair remains separate, not claimed complete here.

The same sole normal writer now checks complete market/professional coverage,
reads BDL first, then uses one bounded The Odds API board when needed. Its exact
school, unique event, competition, scheduled-time, complete pair, line, hold and
native freshness checks reuse the existing quote semantics. It never constructs
a pair across providers. Playbook public splits continue through existing capture
and decision context with their own public/consensus role.

One final resolver sees all transport pairs together. The newest native book state
wins; identical copies count once; contradictory same-book/same-clock states are
quarantined. A third transport cannot revive a frontier by erasing the other two
conflicting pairs. Actual source event IDs and request/availability clocks survive
the new compact path R6. Legacy R5 tuples decode unchanged; older locked payloads
are rendered first and never rewritten. Validated request starts, when present,
are the lower receipt bound, so an already-in-flight request is not a later reaction.
An invalid request clock makes only that lower bound unknown; the genuine quote
and known response availability remain usable. Unknown lower bounds cannot prove
cross-book leadership and must not abort an otherwise coherent source episode.

The free quota endpoint and at most one eight-book/three-market board request use
the existing cron only. The documented board cost is three credits; live response
headers must verify actual cost and remaining balance. At least 1000 credits are
reserved. Errors expose only safe status text, not the key or request URL.
Actual request-attempt counters survive failed reads. No new provider request is
made by opening a card. Existing prices/forecasts remain preserved when a primary
outage has no qualified replacement rather than silently flattening that game.

## Evidence and limits

Functional tests use actual captured CBB fixtures/native quotes in the documented
The Odds API wire form, plus explicitly synthetic conflict and BDL-source controls.
These are not actual additional The Odds API offers or accuracy evidence. Tests
cover both source sides on all three cards/readers, duplicate/conflict/frontier
semantics, request overlap, source origin round trip, quota/error paths, free BDL
before paid fallback, outage continuity and old locked tracking/reader precedence.

The fixed canonical-input comparison reproduces 43 games /129 markets, 68 Leans
and 61 Watchlists, with zero score/side/grade changes. No formula, threshold,
stake or blind favorite/underdog rule is added. New real source inputs can change
future forecasts and selected target prices through existing model logic.

R37 production was verified at `fb905d95`: normal 15:32 UTC refresh completed at
15:34:12 UTC with 415 complete rolling forecasts, 65 November 5 games, restored
quotes/split panels on all four affected aliases, complete price/split history and
148 original locked records unchanged (including 10 November 4 records). Four
future fixtures with unconfirmed official input remain internal. This source
increment does not resolve lower-division same-level-stat ingestion, the 99.9%
normal-tail issue, or every cross-sport provider failure/rate-control path.

Before completion, verify production R38/R21/R17/R6/R24, normal leased cron,
actual The Odds API quota/cost/coverage receipts, exact source IDs and native/arrival
clocks, all three reader markets, original lock hashes, and no archive regression.
