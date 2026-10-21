# NBA exact team-rating identity recovery (r13)

## Scope and predeclaration

- Sport: NBA.
- Affected input: Basketball Reference team ratings used by the opening-month
  regressed prior-season handoff and the model data-quality gate.
- Affected outputs: future-unlocked model release, market-marriage provenance,
  grade release, and daily-refresh provenance. Moneyline, Spread, and Total
  must be compared together because all three consume the shared quality tier.
- Incumbent releases: model/prediction record r12, market marriage r15, grade
  r6, and daily refresh r10.
- Candidate releases: model/prediction record r13, market marriage r16, grade
  r7, daily refresh r11, and team-rating refresh r1.
- Sole writer: `/api/cron/nba-daily-refresh` and the existing NBA tracking
  writer under `prediction_pipeline:nba`. No new writer, timer, provider, or
  lease is added.
- Locked records: immutable and outside the candidate. The existing stored-card
  precedence remains authoritative.

## Live defect

The October 21 production read contained 11 games, complete lines and splits,
known injuries for both teams in every game, and at least 17 named books per
game. Seven games were high-quality, but four were incorrectly marked fallback:

- Golden State at Los Angeles Lakers (`GS` stored versus `GSW` provider)
- Milwaukee at Washington (`WSH` versus `WAS`)
- Utah at Memphis (`UTAH` versus `UTA`)
- Indiana at New Orleans (`NO` versus `NOP`)

The ratings importer compared abbreviations directly after only the narrower
Basketball Reference normalization. The exact shared NBA identity registry
already knew all four pairs, but this importer did not use it. The same defect
had omitted those teams from the 2025-26 prior-season pack, so refreshing only
the new 2026-27 page could not repair opening-month model quality.

## Candidate

The importer now resolves both provider and stored abbreviations through the
existing exact NBA registry and accepts exactly one matching stored team.
Unknown or ambiguous identities fail closed. A full daily cycle additionally
checks the prior regular-season pack: when any current NBA team is missing, it
performs one bounded prior-season regular/playoff recovery; once all 30 regular
rows exist, subsequent full cycles skip those provider calls. Intraday cycles
remain market-only.

No score coefficient, probability distribution, market-reader rule, threshold,
price selector, stake, cadence, tracking boundary, or locked payload changes.
The read-only audit override exists only to compare the same current board and
is never passed by production.

## Same-input current-board result

At `2026-10-21T14:33:49Z`, the read-only provider fetch returned all 30 prior-
season teams and mapped all 30 uniquely. On the exact 11-game/33-market board:

- fallback games: 4 to 0;
- score changes: 0;
- prediction-side changes: 0;
- probability, selected-price, and sportsbook changes: 0;
- actionables: 6 to 9;
- promotions: 3; demotions: 0;
- promotions: Milwaukee Moneyline Watchlist to Lean, Memphis Moneyline
  Watchlist to Lean, and Memphis -1.5 Spread Watchlist to Best Angle.

The promotions come from restoring the already-required high-quality input
gate; they do not add a new grade lane. The final compact audit at
`2026-10-21T14:44:43.935Z` found zero nonpositive model-fair-probability EV
actionables and zero nonpositive-EV promotions.

## Verification and rollback

Required: exact alias and ambiguity tests, one-time prior recovery contract,
feature/pipeline/reader/grade/lock focused tests, TypeScript, lint, full model-
change verification, same-input compact audit, latest-main integration safety,
protected PR checks, and post-deploy proof of 30 prior regular rows, 11/11 high-
quality games, complete reader evidence, one writer/lease, healthy tracking,
and unchanged existing locks.

Rollback future-unlocked generation to r12/r15/r6 and refresh r10 if identity
matching becomes ambiguous, provider requests repeat after complete recovery,
the board loses coverage, a score/side changes outside the reviewed candidate,
an actionable has nonpositive exact-price EV, the writer overlaps, or any
stored lock changes. Do not delete or rewrite any r13 lock.
