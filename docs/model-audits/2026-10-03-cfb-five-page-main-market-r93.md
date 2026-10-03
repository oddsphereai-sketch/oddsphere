# CFB five-page Sharp main-market completion r93

## Predeclaration

The live r92 release restored partitioned sportsbook evidence and published all three predictions
for every remaining CFB game. Its release-pure refresh still reported an isolated Sharp odds
fallback warning. A bounded read-only reproduction found 24 selected fallback games: 22 completed,
while GASO-CCU and MRSH-JMU each stopped at the existing four-page event cap.

Provider inspection proved both exact events contain five pages and terminate normally on page
five. Pages one through four each contain 200 rows; page five contains 83 and 151 rows respectively.
Although the request specifies `market=main`, the provider includes 150-183 alternate rows on each
full page. The terminal page contains additional real named sportsbooks and 25-26 main-line rows.

## Candidate

Raise only `CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT` from four to five and release-stamp the Sharp
adapter, collector and sole writer. Preserve:

- the 24-game writer selection limit;
- the 192-request all-run hard cap;
- the 60-second attempt deadline;
- strict matchup/date/kickoff identity and the r15 partition resolver;
- repeated-page and forward-offset failure guards;
- event-scoped failure isolation;
- all score, PMF, market-arbitration, grade, stake, lock, tracking and UI behavior.

A response still reporting `has_more` after page five remains unavailable and cannot contribute a
partial or synthetic market. The change adds no scheduled job or provider loop.

## Acceptance

- Focused regression proves offsets 0, 200, 400, 600 and 800 are consumed and a sixth page remains
  fail-closed.
- Re-run the exact remaining-slate batch. It must match 24/24 in no more than 50 requests and remain
  below the 60-second deadline.
- Run the complete CFB production contract, TypeScript, `npm run verify:model-change`, latest-main
  integration safety and protected PR checks.
- After deployment, run the sole leased writer and verify r16/r41/r93 stamps, zero Sharp fallback
  event failures, all remaining games retain three predictions, the member snapshot updates, and
  terminal cards remain immutable.

## Candidate result

- Exact live-provider replay: 24 selected games, 24 matched, zero event failures, 48 total requests,
  32.338 seconds.
- Zero-write production-path replay: 37 unlocked games, 111/111 market outlooks, 65 evaluated
  exact-price markets, 46 truthful holds, zero capture failures, and no Sharp fallback warning.
- Board counts are 9 Best Angles / 30 Leans / 23 Watchlists / 3 No Plays across evaluated markets.
  Compared with the immediately preceding r92 live refresh, one Best Angle becomes Watchlist as
  current inputs advance; Leans and No Plays are unchanged, so actionables move 40 to 39. The
  owner has explicitly accepted one-play variance rather than requiring a flat-board quota.
- Remaining health states are `authoritative_market_anchor_unavailable` for games without a valid
  canonical cross-book anchor and `playbook_injuries_request_failed`, whose direct provider probe
  returns HTTP 404 for NCAAF. Neither state removes a prediction; no missing evidence is inferred.

## Rollback

Roll back r16/r41/r93 together to r15/r40/r92. Preserve all append-only evidence, member snapshots,
locks and tracking records.
