# CFB Kalshi next-day contract display repair

Scope: member prediction-market display, its existing five-minute collector,
selected-contract history priority, and future pre-lock display receipts only.
Starting production base: `ea86c90b22649db91c85c4582de7127aae9a1e4f`.
Display release: `kalshi_event_date_match_2026_10_30_r1_rule_verified`.
No forecast, probability, selected price, pick, grade, stake, model input,
prediction writer, split reader, source ranking, or lock rule is changed.

## Reproduction and provider evidence

Published event `457751`, Illinois at Maryland, is open with kickoff
`2026-10-31T16:00:00Z`. Both official school schedules confirm October 31:

- https://umterps.com/sports/football/schedule
- https://fightingillini.com/news/2026/10/19/football-illinois-at-maryland-to-kick-at-11-am-ct-on-oct-31

OWLS winner rows use `KXNCAAFGAME-26OCT30ILLMD`, while spread and total rows
use `KXNCAAFSPREAD-26OCT31ILLMD` and `KXNCAAFTOTAL-26OCT31ILLMD`.
The prior exact-date winner gate rejected the game, and selected spread/total
capture also depended on that winner gate. Copying the winner suffix alone
would still select the wrong spread/total event date.

The original-date winner's actual `rules_primary` identifies the college
football game originally scheduled for October 30, 2026. Its
`rules_secondary` expressly keeps the contract valid if the postponed game
begins within 48 hours of its original scheduled start. Both opponent
contracts contain that policy, verified in OWLS pass-through fields and the
public exchange event response:

https://external-api.kalshi.com/trade-api/v2/events/KXNCAAFGAME-26OCT30ILLMD?with_nested_markets=true

Expiration and close timestamps are not used as kickoff evidence.

## Narrow matching and preservation contract

- Exact-date legacy behavior remains unchanged.
- A next-calendar-day join is CFB-only, requires an explicitly open published
  future game and a non-passed valid lock timestamp (or no lock timestamp),
  exact opponent identity, both independently verified 48-hour policies,
  coherent fresh quotes, and exactly one eligible event. Unknown rules,
  ambiguous events, other sports, started games, and existing locks do not
  gain a widened join.
- Original winner ticker, original source date, quote timestamps, prices and
  histories remain intact. Only the verified current published date is
  carried as auxiliary match metadata.
- Spread/total resolution prefers the actual-date event. An original-date
  fallback requires its own verified rule; events and thresholds are not
  stitched together.
- Existing stored locked evidence keeps reader precedence. No old member
  snapshot is rewritten and no retrospective pre-lock receipt is created.
- The same collector and sport lease remain authoritative; no new poller,
  upstream request, request budget, or per-user provider call is introduced.

## Verification

The new event-date regression covers all three markets, capture selection,
policy absence/conflict, ambiguous events, stale quotes, wrong opponents,
cross-sport and lock rejection, next-day bounds, immutable legacy precedence,
and no mutation of published game/provider inputs.

All prediction-market tests, TypeScript, and `npm run verify:model-change`
passed. Focused ESLint has zero errors (one pre-existing unused-variable
warning in `predictionMarketPrelock.ts`). The optional local PostgreSQL proof
in the model suite was skipped because its database URL is unset.

A zero-write public-exchange rehearsal against the published 21:40 UTC board
recovered only Illinois's previously missing event match; the 63 existing
matches remained unchanged. It resolved the exact selected Illinois winner,
Illinois -2.5 spread (`ILL3`), and Over 54.5 (`55`) total contracts and produced
all three future pre-lock display receipts locally without storing them.
Stored winner history already has hundreds of genuine observations; the
newly admitted spread/total history must be collected by the unchanged
bounded history path. Do not claim full two-source history until production
capture and the rendered reader verify it.

Publication requires the current-main ancestor/overlap check, protected PR
checks, production commit confirmation, a subsequent scheduled capture,
actual Illinois reader checks across markets, and unchanged legacy lock
payload hashes. Roll back the display change if it causes an ambiguous join,
wrong market/side, changed existing lock, or capture/reader failure.
