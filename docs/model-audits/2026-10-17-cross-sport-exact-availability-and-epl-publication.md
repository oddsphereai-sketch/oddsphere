# Cross-sport exact availability and EPL publication repair — 2026-10-17

## Owner intent and predeclaration

The repair must fetch and verify the injury data itself. It must not add member copy, reinterpret a missing feed as medical clearance, fabricate an injury, or weaken a future-game market gate. The same contract applies across sports: a zero-injury result is valid only when the authoritative response explicitly contains both teams for the exact game and contains a structurally complete empty list for that team.

Expected behavior before inspection of the current-board result:

- malformed, missing, one-sided, duplicate, or matchup-mismatched injury payloads remain unknown;
- an explicit empty list in a complete exact-game response remains verified zero;
- NBA changes run under a new market-marriage release because injury completeness is a model input and grade qualifier;
- EPL current-price coverage remains strict for every scheduled match, while live/final games no longer block publication after books remove offers;
- no stored locked record is rewritten or reinterpreted.

## Defects repaired

1. NBA's legacy team injury endpoint returned HTTP 200 with `{}`. Its parser incorrectly promoted that malformed body to known zero. Production now uses the ESPN exact-event summary, caches one request per game, requires both canonical matchup teams, and fails closed on every partial structure. The old team fetcher is removed from production and audit callers.
2. NHL could publish a goalie-only report when the exact-game injury summary failed. Goalies remain useful context, but they no longer certify injury health. Both exact injury groups are required.
3. WNBA accepted an empty or one-sided summary as a game report. Both exact groups are now required.
4. MLB's official 40-man fallback accepted any array, including empty or truncated responses. It now requires at least 25 roster rows and at least 90% complete name/status identity before an explicit zero can be trusted.
5. EPL's weekly publication gate treated an already-started match as a fixture that must still have current sportsbook offers. It now gates only `scheduled` fixtures. Locked/live cards retain the existing immutable-reader precedence.

## Release identifiers

- NBA market marriage: `nba_market_marriage_2026_10_17_r6_exact_game_injury_authority`
- NHL member availability: `espn_nhl_availability_2026_10_17_r2_exact_matchup_injury_verification`
- WNBA member availability: `espn_wnba_availability_2026_10_17_r1_exact_matchup_injury_verification`
- EPL publication lifecycle: `epl_member_snapshot_lifecycle_2026_10_17_r5_scheduled_fixture_price_gate`
- NBA model, grade policy, point-projection policy, reader, writer, lease, lock policy, and stake policy are unchanged.
- EPL model, grade policy, writer, lease, lock policy, and stake policy are unchanged.

## Same-input NBA board result

The read-only October 20 comparison ran the exact-game authority against the prior effective behavior (both teams marked known with empty injury lists):

- 3 games / 9 markets;
- 3/3 games verified both exact teams;
- 18 reported players recovered, including one Out player;
- 0 pick changes;
- 0 projection changes;
- 0 grade changes;
- 0 promotions and 0 demotions;
- 0 actionable-count change.

This is not a claim that injuries never matter. The active professional score model still assigns no arbitrary point value to a listed player; verified availability can only exercise the already-versioned confidence and grade safeguards. The current three-game comparison happened to remain unchanged.

## Live collector and publication result

- NHL: 14/14 exact games returned two verified injury groups; 100 injury rows were present, with published goalie context kept separate from injury completeness.
- WNBA: ATL at GS returned both exact groups and four injury rows.
- MLB: TB at CLE used the official MLB Stats fallback; complete 40-man responses verified five TB injured-list players and an explicit zero for CLE.
- EPL: current status was one final, three in progress, and six scheduled. The repaired denominator evaluated only the six wagerable matches and passed 24/24 selected current prices plus 60/60 outcome-board rows with zero errors.

## Locked-record and board guarantees

- No locked NBA, NHL, WNBA, MLB, or EPL payload is mutated.
- EPL scheduled fixtures still require 4/4 selected prices and 10/10 outcome-board rows per game.
- A live/final EPL game is excluded only from the current-offer publication denominator; its stored member tuple remains governed by locked-record precedence.
- Availability collectors return no report for an unverified matchup, allowing the aggregate health audit to identify the gap instead of converting it to zero.

## Rollback

Revert the exact-game collector release and EPL lifecycle release for future unlocked reads only. Never rewrite or reconstruct an existing locked payload. If ESPN's exact-event schema changes, fail the affected availability reports closed until a new structurally tested parser release is ready.
